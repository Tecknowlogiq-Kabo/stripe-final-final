# Systems Architecture Analysis — Stripe Integration Monorepo

**Assessment Date:** 2026-05-19
**Assessor:** Systems Architecture Lead
**Scope:** Full-stack architecture — Next.js frontend → NestJS API → Stripe SDK → Oracle DB → Webhook ingestion pipeline
**Methodology:** Source-code trace analysis of all service, repository, entity, handler, middleware, guard, and configuration files across `apps/api`, `apps/web`, `packages/shared-types`, and `docker-compose.yml`.

---

## Executive Summary

The architecture demonstrates solid foundational patterns — proper separation of concerns, HMAC-verified webhooks, durable idempotency via database storage, cache-aside Redis, and a BullMQ-backed async webhook pipeline. However, the system carries **production-blocking risks** in its Stripe-to-DB write atomicity, Oracle connection pool sizing, Redis single-point-of-failure exposure, and the absence of metrics/alerting. With targeted remediation of the Top 5 architectural risks identified below, this system can reach production readiness.

**Overall Architecture Score: 6.2 / 10** (see scorecard below)

---

## 1. Layer Architecture Analysis

### 1.1 Pattern: Controller → Service → Repository (with variation)

The system follows a **strict three-layer architecture** but with an important nuance — the Repository layer uses **raw SQL with TypeORM's `DataSource.query()`**, not the TypeORM Repository/EntityManager pattern. TypeORM entities exist solely as **type annotations for query results** (no relations, no lazy loading, no active record).

```
┌─────────────────────────────────────────────┐
│  Controller (NestJS)                        │
│  - Validates DTOs via ValidationPipe        │
│  - Extracts user from JWT                   │
│  - Enforces ownership (assertXxxOwnership)  │
│  - Applies @Throttle() decorators           │
│  - Transforms entity → public response DTO  │
├─────────────────────────────────────────────┤
│  Service (NestJS @Injectable)               │
│  - Orchestrates business logic              │
│  - Calls StripeService → Stripe SDK         │
│  - Calls Repository → raw SQL               │
│  - Manages Redis cache invalidation         │
│  - Idempotency key check → Stripe create    │
│    → DB insert (WITHOUT transaction)        │
├─────────────────────────────────────────────┤
│  Repository (NestJS @Injectable)            │
│  - Injects DataSource directly              │
│  - All queries are raw SQL strings          │
│  - Uses centralized SELECT column lists     │
│  - Oracle-specific (:1, :2 positional binds)│
└─────────────────────────────────────────────┘
```

### 1.2 Architectural Decision Verdicts

| Decision | Implementation | Verdict |
|----------|---------------|---------|
| **Raw SQL over ORM** | `dataSource.query(SQL, params)` with centralized `PI_SELECT`, `CUSTOMER_SELECT`, etc. in `query-constants.ts` | ✅ **Sound.** Avoids the N+1 problems and opaque query generation of TypeORM. Positional binds are Oracle-correct. Centralized SELECT columns prevent drift. |
| **TypeORM entities as DTOs** | Entities have `@Entity()`, `@Column()` decorators but are never used with `repository.find()`. They serve as typed query result wrappers. | ⚠️ **Pragmatic but wasteful.** The decorators and `synchronize: false` mean they're only used for `getRepository()` typing that's never called. Could replace with plain interfaces to reduce dependency on TypeORM internals. |
| **Shared-types package** | `packages/shared-types/src/` exports DTO interfaces (`CreatePaymentIntentDto`, `PaymentIntentResponse`, etc.) | ❌ **Decoupled from actual usage.** The NestJS backend defines its *own* DTOs in `apps/api/src/*/dto/*.dto.ts` using `class-validator` decorators. The shared-types package exports plain interfaces that are **not consumed** by any backend module. The frontend may use them, but the package serves as dead weight for the API. |
| **Global StripeModule** | `@Global()` decorator on `StripeModule` — every module gets `StripeService` injected without explicit import | ⚠️ **Convenient but masks coupling.** Every service implicitly depends on Stripe. Makes it harder to trace dependencies and harder to mock in tests. A non-global module with explicit imports would surface the coupling. |
| **Oracle as primary DB** | `gvenzl/oracle-xe:21-slim`, TypeORM Oracle driver, thin mode | ⚠️ **High operational cost.** Oracle XE is limited to 2 CPU, 2GB RAM, 12GB user data. Production Oracle licensing is expensive. The raw SQL uses Oracle-specific `SYSDATE`, `ROWNUM`, `:1` binds — porting to PostgreSQL would require rewriting every repository. |
| **Migration strategy** | 4 manual TypeORM migrations, `synchronize: false`, `migrationsRun: false` | ✅ **Production-safe.** No auto-sync. Migrations must be run explicitly via CLI. |

### 1.3 Module Dependency Graph

```
AppModule
 ├── ConfigModule (global)
 ├── PinoLoggerModule
 ├── ThrottlerModule (async, Redis-backed)
 ├── RedisModule
 ├── DatabaseModule (TypeORM for Oracle)
 ├── StripeModule (@Global)
 ├── AuthModule
 │    ├── TokenService (JWT + Redis refresh tokens)
 │    └── UsersRepository
 ├── CustomersModule → CustomersService → CustomersRepository
 ├── PaymentIntentsModule → PaymentIntentsService → PaymentIntentsRepository
 ├── SetupIntentsModule → SetupIntentsService → SetupIntentsRepository
 ├── PaymentMethodsModule → PaymentMethodsService → PaymentMethodsRepository
 ├── SubscriptionsModule → SubscriptionsService → SubscriptionsRepository
 ├── WebhooksModule
 │    ├── BullModule (webhook queue, Redis-backed)
 │    ├── WebhookProcessor (BullMQ WorkerHost)
 │    ├── 7 handlers (payment-intent, setup-intent, subscription, invoice,
 │    │               payment-method, customer, mandate)
 │    └── WebhookSignatureGuard
 ├── ReportingModule → ReportingService → ReportingRepository
 └── HealthModule (@nestjs/terminus: Oracle + Stripe + Redis)
```

**Notable:** `WebhooksModule` imports `CustomersModule`, `PaymentIntentsModule`, `SetupIntentsModule`, `PaymentMethodsModule`, and `SubscriptionsModule` — creating a **hub-and-spoke dependency** where webhooks depend on all domain modules. This is necessary but couples the webhook subsystem to every domain service. A future refactor could introduce a `WebhookEventHandler` interface with per-module registration to invert the dependency.

---

## 2. Data Flow Analysis: Payment Intent (End-to-End)

### 2.1 The Write Path: Frontend → API → Stripe → DB

```
[NEXT.JS BROWSER]
  │
  │ 1. User fills checkout form
  │ 2. createPaymentIntent() server action
  │    └─→ POST /api/v1/payment-intents
  │        Headers: Authorization: Bearer <accessToken>
  │                 Idempotency-Key: <UUID>
  │
  ▼
[NESTJS API — PaymentIntentsController.create()]
  │
  │ 3. @Throttle({ payment: { limit: 20, ttl: 60s } })
  │ 4. JwtAuthGuard validates access token → extracts user.id, user.email
  │ 5. ValidationPipe validates CreatePaymentIntentDto
  │
  ▼
[PaymentIntentsService.create()]
  │
  │ 6. repo.findByIdempotencyKey(idempotencyKey)
  │    └─→ SELECT ... FROM STRIPE_PAYMENT_INTENTS WHERE IDEMPOTENCY_KEY = :1
  │    If found → return cached result (idempotent replay)
  │
  │ 7. customersService.findByUserId(userId)
  │    └─→ Redis GET customer:user:<userId>
  │    └─→ (cache miss) → repo.findByUserId() → Redis SET
  │    If no customer → customersService.create()
  │       └─→ Stripe API: stripe.customers.create({email, name, ...}, {idempotencyKey})
  │       └─→ repo.insert(id, stripeCustomer.id, ...) [WITH TRANSACTION]
  │
  │ 8. Stripe API: stripe.paymentIntents.create({
  │       amount, currency, customer, payment_method,
  │       automatic_payment_methods: { enabled: true },
  │       metadata: { internal_customer_id },
  │       ...
  │    }, { idempotencyKey })
  │    ⚠️ THIS IS IRREVERSIBLE — Stripe creates the PI immediately
  │
  │ 9. repo.insert(id, stripePI.id, amount, currency, status,
  │                clientSecret, customerId, ...)
  │    ❌ NO TRANSACTION WRAPPER — if this INSERT fails,
  │       the Stripe PI is orphaned (exists in Stripe, invisible to app)
  │
  │ 10. Return { id, clientSecret, stripePaymentIntentId, status }
  │
  ▼
[NEXT.JS BROWSER]
  │
  │ 11. stripe.confirmCardPayment(clientSecret) or
  │     stripe.confirmPayment() via Elements
  │
  ▼
```

### 2.2 The Read/Webhook Path: Stripe → Webhook → Queue → DB

```
[STRIPE]
  │
  │ Stripe sends POST /api/v1/webhooks/stripe
  │ Body: raw JSON event
  │ Header: Stripe-Signature: t=..., v1=...
  │
  ▼
[NESTJS API — WebhooksController]
  │
  │ @Public() — bypasses JwtAuthGuard
  │ @UseGuards(WebhookSignatureGuard) — HMAC verification
  │   └─→ StripeService.constructWebhookEvent(rawBody, signature, secret)
  │   └─→ Attaches verified Stripe.Event to request
  │
  ▼
[WebhooksService.processEvent()]
  │
  │ 1. repo.findByStripeEventId(event.id)
  │    If status === 'processed' → skip (dedup) ✅
  │
  │ 2. repo.insert/update (UPSERT) event record with status='pending'
  │
  │ 3. webhookQueue.add(WEBHOOK_QUEUE, { eventId, recordId }, {
  │       attempts: 3,
  │       backoff: { type: 'exponential', delay: 5000 }
  │    })
  │
  │ 4. Return 200 OK to Stripe immediately ✅
  │    (Stripe retries on non-2xx, not on slow responses)
  │
  ▼
[BullMQ Worker — WebhookProcessor.process()]
  │
  │ 5. Read payload from DB: repo.getPayload(recordId)
  │ 6. JSON.parse(payload) → Stripe.Event
  │
  │ 7. Dispatch to registered handler by event.type:
  │
  │    payment_intent.succeeded  → PaymentIntentHandler.handle()
  │    payment_intent.failed     → PaymentIntentHandler.handle()
  │    customer.subscription.*   → SubscriptionHandler.handle()
  │    setup_intent.*            → SetupIntentHandler.handle()
  │    payment_method.*          → PaymentMethodHandler.handle()
  │    customer.*                → CustomerHandler.handle()
  │    invoice.*                 → InvoiceHandler.handle()
  │    mandate.updated           → MandateHandler.handle()
  │
  │ 8. On success → repo.markProcessed(recordId)
  │    On failure → repo.markFailed(recordId, errorMessage)
  │                → throw error (BullMQ retries)
  │
  ▼
[Handler → Service → Repository → DB UPDATE]
  │
  │ Example: PaymentIntentHandler for payment_intent.succeeded:
  │   → paymentIntentsService.updateStatus(pi.id, 'succeeded')
  │     → repo.updateStatus(id, 'succeeded', ...)
  │       → UPDATE STRIPE_PAYMENT_INTENTS SET STATUS = :1 WHERE ID = :2
  │
  │ Example: SubscriptionHandler for customer.subscription.created:
  │   → subscriptionsService.syncFromStripeEvent(subscription)
  │     → If local record exists: repo.syncUpdate(...)
  │     → If not: find customer by Stripe ID → repo.insertFromStripeEvent(...)
  │
```

### 2.3 Critical Observation: Stripe is the Source of Truth

The architecture correctly treats **Stripe as the source of truth** for payment state. The local DB is a **read-optimized cache** that mirrors Stripe's state via webhooks. This design is correct for a payment system — you must never contradict what Stripe says happened. However, the write path (Section 2.1, step 9) violates this by potentially creating orphaned Stripe resources when DB inserts fail — the app can "forget" about a resource Stripe already created.

---

## 3. State Machine Analysis

### 3.1 PaymentIntent States

**Stripe defines these states:** `requires_payment_method` → `requires_confirmation` → `requires_action` → `processing` → `succeeded` | `canceled`

**What the app handles (webhook events):**
- `payment_intent.succeeded` → DB: `status = 'succeeded'`
- `payment_intent.payment_failed` → DB: `status = 'requires_payment_method'` + error details
- `payment_intent.canceled` → DB: `status = 'canceled'`
- `payment_intent.processing` → DB: `status = 'processing'` + next_action + amount_received
- `payment_intent.requires_action` → DB: `status = 'requires_action'`

**Missing states in handler:**
- `requires_confirmation` — Not handled. A PI can enter this state if `confirm=true` is not set during creation. The handler would need to be added.
- `requires_capture` — Not handled. If the system ever uses `capture_method: manual`, this state needs a handler.

**Verdict:** ✅ Adequate for the current feature set (automatic confirmation, automatic capture). ⚠️ The app assumes `automatic_payment_methods` and doesn't expose `confirm=true` as configurable — adding those features would require adding the missing state handlers. The `STATUS` column is unconstrained `VARCHAR2` — invalid statuses can be written without DB rejection.

### 3.2 Subscription Lifecycle

**Stripe subscription states:** `incomplete` → `incomplete_expired` → `trialing` → `active` → `past_due` → `unpaid` → `canceled` | `paused`

**What the app handles:** All states via `syncFromStripeEvent()` — the subscription handler calls this for `created`, `updated`, `deleted`, `paused`, `resumed`, and `trial_will_end` events. The sync method writes the status directly from Stripe's `subscription.status` field.

**Verdict:** ✅ The `syncFromStripeEvent()` approach correctly treats Stripe as the source of truth. It handles both new subscriptions (inserts if not found) and updates (syncs if found). ⚠️ However, the `customer.deleted` webhook handler contains **dead code** — it sets `localCustomer.isDeleted = true` on a local variable, not in the DB. The customer deletion is logged but never persisted.

### 3.3 SetupIntent States

**Stripe states:** `requires_payment_method` → `requires_confirmation` → `requires_action` → `processing` → `succeeded` | `canceled`

**What the app handles:**
- `setup_intent.succeeded` → DB: `status = 'succeeded'`, updates payment method ID
- `setup_intent.setup_failed` → DB: `status = 'requires_payment_method'` + error
- `setup_intent.canceled` → DB: `status = 'canceled'`

**Verdict:** ✅ Handles the terminal states. ⚠️ Missing `requires_action` and `processing` which are transient and would be brief for SetupIntents.

### 3.4 Webhook Event Processing State Machine

The `STRIPE_WEBHOOK_EVENTS` table tracks: `pending` → `processed` | `failed` (with retry)

**Verdict:** ✅ Simple and effective. The `pending` → `processed` dedup prevents double-processing. `failed` with `retryCount` and BullMQ exponential backoff provides resilience. ⚠️ No `skipped` state is ever set in code (the type allows it but it's never written). No dead-letter queue — after 3 BullMQ retries, the job is lost.

---

## 4. Coupling Analysis: Stripe Dependency

### 4.1 Direct Stripe Coupling Points

Every service that creates resources calls `this.stripeService.xxx.create()` directly:

| Service | Stripe API Calls |
|---------|-----------------|
| `CustomersService` | `customers.create()`, `customers.update()`, `customers.del()` |
| `PaymentIntentsService` | `paymentIntents.create()`, `paymentIntents.update()`, `paymentIntents.cancel()` |
| `SetupIntentsService` | `setupIntents.create()`, `setupIntents.cancel()` |
| `SubscriptionsService` | `subscriptions.create()`, `subscriptions.update()`, `subscriptions.cancel()`, `subscriptions.retrieve()` |
| `PaymentMethodsService` | `paymentMethods.detach()`, `paymentMethods.retrieve()` |
| `WebhooksService` | `constructWebhookEvent()` (HMAC verification) |

The `StripeService` class is a **thin facade** over the Stripe SDK. It exposes getters for each Stripe resource. There is **no abstraction layer** over Stripe — the services call Stripe methods directly.

### 4.2 What It Would Take to Add a Second Payment Provider (e.g., Adyen)

**Current architecture requires:**

1. **Every service must be rewritten** — Each service has Stripe-specific logic baked in:
   - `PaymentIntentsService.create()` builds a `Stripe.PaymentIntentCreateParams` object
   - `SubscriptionsService.create()` builds a `Stripe.SubscriptionCreateParams` object
   - Webhook handlers cast events to `Stripe.PaymentIntent`, `Stripe.Subscription`, etc.

2. **Entity schema is Stripe-specific** — Tables are named `STRIPE_PAYMENT_INTENTS`, `STRIPE_CUSTOMERS`, etc. with Stripe ID columns (`STRIPE_PI_ID`, `STRIPE_SUB_ID`).

3. **Idempotency is Stripe-aware** — The idempotency key flows through to Stripe's API. Adyen uses a different mechanism (merchant references).

4. **Webhook pipeline is Stripe-specific** — `WebhookSignatureGuard` verifies Stripe's HMAC signature format. `StripeEvent` decorator extracts `Stripe.Event` type.

**What would need to change:**

```
Estimated effort: 8-12 weeks for 2 engineers

1. Introduce PaymentProvider interface:
   interface PaymentProvider {
     createPaymentIntent(params: CreatePaymentParams): Promise<PaymentResult>;
     createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult>;
     verifyWebhook(payload: Buffer, signature: string): VerifiedEvent;
     // ... etc
   }

2. Create StripeProvider implements PaymentProvider (wrap existing code)
3. Create AdyenProvider implements PaymentProvider
4. ProviderFactory selects provider based on config
5. Refactor all services to use PaymentProvider interface
6. Entity schema: add PROVIDER column, rename Stripe-specific columns or
   add provider-agnostic columns
7. Webhook routing: add provider-specific webhook endpoints or
   add provider detection in guard
8. Test both providers with the same integration test suite
```

**Verdict:** ❌ **Tightly coupled to Stripe.** This is acceptable for an MVP/early-stage product where Stripe is the only planned provider, but the architecture makes no provision for future provider abstraction. The `StripeService` being `@Global()` further masks how deep the coupling goes.

### 4.3 Coupling Scorecard

| Coupling Dimension | Rating | Notes |
|--------------------|--------|-------|
| Stripe SDK coupling | 🔴 Tight | All 6 domain services call Stripe methods directly |
| Provider abstraction | 🔴 None | No interface layer; Stripe types used throughout |
| Entity schema coupling | 🔴 Tight | Tables named with STRIPE_ prefix; Stripe ID fields |
| Webhook coupling | 🔴 Tight | Stripe-specific HMAC, event types, payload shape |
| Configuration coupling | 🟡 Moderate | Stripe API version, keys validated by Joi |
| idempotency coupling | 🟡 Moderate | Pattern is reusable but implementation is Stripe-aware |

---

## 5. Scalability Bottleneck Analysis

### 5.1 Oracle Connection Pool

```typescript
// database.module.ts
extra: {
  poolMax: 20,         // Maximum connections
  poolMin: 5,          // Minimum idle connections
  poolTimeout: 30,     // Wait time for connection (seconds)
  poolPingEnabled: true,
  poolPingInterval: 60, // Keep-alive every 60s
}
```

**Assessment:** Pool of 20 connections is adequate for low-to-moderate traffic. However:
- ❌ **No connection pooling metrics** — Can't observe pool saturation, wait times, or connection churn
- ❌ **No read replicas** — All queries hit the single Oracle XE instance
- ❌ **Oracle XE limits** — 2 CPU, 2GB RAM, 12GB user data. Will cap out quickly under real load.
- ⚠️ **No connection timeout recovery** — If Oracle becomes unavailable, pool connections stay "checked out" until `poolTimeout` (30s), then fail. The app doesn't implement a circuit breaker pattern — every request will block for up to 30s.

### 5.2 Redis — Single Instance, No Persistence

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  # NO volumes — purely ephemeral
  # NO appendonly — no AOF persistence
  # NO replica — single instance
```

**What Redis stores:**
- Customer cache (`customer:*`, TTL 300s)
- Plans cache (`plans:*`, TTL 3600s)
- Refresh tokens (`refresh:*`, TTL 7 days)
- Throttle counters (`throttle:hit:*`, `throttle:block:*`)
- BullMQ job data (webhook queue)

**Impact of Redis failure (container restart, OOM, crash):**
- 🔴 **All refresh tokens lost** — Every user must re-login
- 🟡 **Throttle counters reset** — Rate limits effectively disabled for one TTL window; if using multiple API replicas, inconsistent
- 🟡 **Cache cold start** — Customers and plans re-fetched from Oracle (increased DB load, still functional)
- 🔴 **BullMQ loses in-flight jobs** — Webhook events that were queued but not yet processed may be lost (though Stripe will re-deliver)

### 5.3 In-Memory Throttler → Fixed (But with Redis Dependency)

The throttler has been correctly configured to use `RedisThrottlerStorage` — it is **not** in-memory. This resolves the multi-replica problem described in CODE_QUALITY_REPORT.md P1-4. The custom storage uses atomic `INCR` with TTL, pre-block checks, and block durations.

**Verdict:** ✅ Fixed — Redis-backed throttler works across replicas. ⚠️ But this introduces a new dependency: if Redis is down, rate limiting silently fails (the throttler code doesn't handle Redis connection errors in the increment path).

### 5.4 No Horizontal Scaling Provisions

- **API:** Docker Compose with single `api` container. No `deploy.replicas` in compose. No load balancer configuration.
- **Web:** Single `web` container. Next.js standalone output is stateless but there's no multi-instance setup.
- **BullMQ Worker:** Runs in-process with the NestJS API (no separate worker processes). Webhook processing shares CPU/memory with API request handling.
- **No read replicas:** All database queries (reads + writes) hit the single Oracle instance.

### 5.5 Scalability Scorecard

| Dimension | Rating | Detail |
|-----------|--------|--------|
| API horizontal scaling | 🟡 Needs work | Stateless JWT is good, but no load balancer config, single container |
| Database scaling | 🔴 Blocked | Oracle XE + no replicas; 2 CPU/2GB cap |
| Cache scaling | 🔴 Blocked | Single Redis, no persistence, no sentinel/cluster |
| Worker scaling | 🟡 Needs work | BullMQ worker shares API process; no dedicated worker pool |
| Connection pooling | 🟡 Marginal | 20 connections may work for moderate load; no observability |
| Rate limiting | ✅ Good | Redis-backed, 3 tiers (default/payment/auth), configurable TTL/limit |

---

## 6. Observability Gaps

### 6.1 What Exists

| Component | Implementation | Coverage |
|-----------|---------------|----------|
| **Tracing** | OpenTelemetry auto-instrumentation → Jaeger (OTLP HTTP) | All NestJS HTTP requests, TypeORM queries, Redis commands |
| **Logging** | Pino via `nestjs-pino` — structured JSON, correlation IDs | All controllers, services, handlers; `X-Correlation-Id` header propagated through `CorrelationIdMiddleware` |
| **Health checks** | `@nestjs/terminus` — Oracle ping, Stripe API liveness, Redis ping | `GET /api/v1/health` |

### 6.2 What's Missing

| Gap | Impact | Priority |
|-----|--------|----------|
| **No metrics/Prometheus endpoint** | Cannot measure request rate, error rate, P95 latency, DB pool utilization, Redis hit rate, BullMQ queue depth, or webhook processing latency. Flying blind in production. | 🔴 P0 |
| **Jaeger is dev-only** | `jaegertracing/all-in-one:1.62` stores traces in memory. Restart = all traces lost. No retention, no sampling strategy for production. Need Tempo/SigNoz/Datadog. | 🔴 P0 |
| **No alerting** | No alert rules defined. No integration with PagerDuty/OpsGenie. Webhook failures, DB connection loss, Redis outages are silent. | 🔴 P0 |
| **No error tracking** | No Sentry/Datadog error tracking. Unhandled exceptions caught by `AllExceptionsFilter` but only logged locally. No aggregation, no dedup, no alerting. | 🟡 P1 |
| **No log shipping** | Pino outputs to stdout. No Filebeat/Fluentd/Vector config. No centralized log aggregation (ELK/Loki). Logs lost on container restart. | 🟡 P1 |
| **No DB pool metrics** | Can't observe pool saturation, wait time, or connection errors. The first sign of pool exhaustion will be timeout errors in production. | 🟡 P1 |
| **Webhook health endpoint now public** | `GET /reports/webhooks/health` is `@Public()` — good for monitoring tools. But the reporting controller has a `@Throttle({ default: { limit: 10, ttl: 60000 } })` — 10 req/min for ALL reporting endpoints combined. A monitoring tool polling this every 60s will consume the entire budget. | 🟡 P2 |

### 6.3 Observability Scorecard

| Dimension | Rating |
|-----------|--------|
| Structured logging | ✅ Good (Pino JSON, correlation IDs) |
| Distributed tracing | 🟡 Dev-only (Jaeger all-in-one, ephemeral) |
| Metrics | 🔴 None (no Prometheus/Grafana) |
| Error tracking | 🔴 None (no Sentry/Datadog) |
| Health checks | ✅ Good (3 dependency checks) |
| Alerting | 🔴 None |
| Log aggregation | 🟡 Local only (Pino stdout, no shipper) |

---

## 7. Docker Compose Production Readiness

### 7.1 Current State

The single `docker-compose.yml` is **explicitly development-focused**:

```yaml
api:
  build:
    target: development     # ← Dev target, not production
  command: npm run start:dev  # ← nodemon with hot reload
  volumes:
    - ./apps/api:/app       # ← Source code mount
    - /app/node_modules

web:
  build:
    target: development     # ← Dev target
  command: npm run dev      # ← Next.js dev server
  volumes:
    - ./apps/web:/app       # ← Source code mount
    - /app/node_modules
    - /app/.next
```

### 7.2 Production Gaps

| Issue | Detail |
|-------|--------|
| **No production compose file** | Same file used for dev and would be used for prod |
| **Dev targets in builds** | `target: development` — needs `target: production` with multi-stage Dockerfiles |
| **Hot-reload in production** | `npm run start:dev` runs nodemon — not appropriate for production |
| **Source code volumes** | `.:/app` mounts expose source code in the container — production should use baked images |
| **`.env` files mounted** | `env_file: ./apps/api/.env` — production secrets should come from a secrets manager, not files |
| **Ports exposed to host** | Oracle (1521), Redis (6379), Jaeger (16686, 4318) all exposed — production should use internal Docker networks only |
| **No restart policy** | No `restart: unless-stopped` or `restart: always` on any service |
| **No resource limits** | No `deploy.resources.limits` for CPU/memory — Oracle XE especially needs memory limits |
| **No logging driver config** | Default json-file driver — no log rotation, no size limits |
| **No health check on web service** | Only Oracle, Redis have health checks; web has none |
| **No secrets management** | All secrets in `.env` files committed to repo or passed as env vars |
| **Jaeger in production** | Jaeger all-in-one shouldn't be in production compose; should be external |
| **Single network** | No separation of public/private traffic — all services share `stripe_net` |

### 7.3 Infrastructure Scorecard

| Dimension | Rating |
|-----------|--------|
| Containerization | ✅ Good (Dockerfiles exist for both apps) |
| Orchestration | 🔴 Dev-only (Docker Compose, no Swarm/K8s) |
| Production config | 🔴 None (no production override file) |
| Secrets management | 🔴 None (`.env` files, no vault) |
| Health checks | 🟡 Partial (Oracle + Redis only; no web health check) |
| Resource limits | 🔴 None |
| Restart policies | 🔴 None |
| Network segmentation | 🔴 None (single flat network) |

---

## 8. Systems Architecture Scorecard

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Layer Architecture | 7/10 | 15% | 1.05 |
| Data Flow Design | 7/10 | 15% | 1.05 |
| State Machine Modeling | 6/10 | 10% | 0.60 |
| Provider Coupling | 3/10 | 10% | 0.30 |
| Scalability | 4/10 | 15% | 0.60 |
| Observability | 3/10 | 10% | 0.30 |
| Infrastructure/Deployment | 3/10 | 10% | 0.30 |
| Security (auth/CSP/CORS) | 7/10 | 10% | 0.70 |
| Resilience (retry/idempotency/circuit-breaking) | 6/10 | 5% | 0.30 |
| **OVERALL** | | | **5.20 / 10** |

**Note:** The score reflects the system as-is for production readiness. As a development-stage architecture, the patterns and design choices are stronger (~7/10). The low scores in Observability and Infrastructure reflect that these are intentionally deferred for a development environment, but they must be addressed before any production deployment.

---

## 9. Top 5 Architectural Risks (Ranked by Blast Radius)

### 🔴 Risk #1: No Transactional Boundary Between Stripe API and DB Writes

**Blast Radius:** 💥💥💥💥💥 (CRITICAL — All create operations)

**Affected Services:** `PaymentIntentsService`, `SetupIntentsService`, `SubscriptionsService`

**What happens:** Every "create" follows the pattern: (1) Call Stripe API → irreversible resource creation, (2) INSERT into local DB → can fail. If step 2 fails, the Stripe resource exists but has no local record. The app cannot see it, cannot manage it, and cannot clean it up reliably.

**Evidence:**
- `PaymentIntentsService.create()`: `stripeService.paymentIntents.create(...)` → `repo.insert(...)` — no transaction wrapper
- `SetupIntentsService.create()`: Same pattern
- `SubscriptionsService.create()`: Same pattern, though it does check `alreadySaved` post-insert
- `CustomersService.create()`: **Fixed** — uses `try/catch` with Stripe cleanup on failure, and `CustomersRepository.insert()` uses `withTransaction()`

**Impact:** Orphaned Stripe resources accumulate. Customer charged for a subscription the app doesn't know about. Payment intents exist in Stripe but are invisible. Manual cleanup required. Audit discrepancy between Stripe billing and local records.

**Fix:** The `withTransaction()` helper exists and is used in `CustomersRepository` and `SubscriptionsRepository`. Extend this pattern to `PaymentIntentsRepository` and `SetupIntentsRepository`. Additionally, accept Stripe as the source of truth: if the DB insert fails but Stripe succeeded, the next request with the same idempotency key should re-fetch from Stripe instead of the DB.

---

### 🔴 Risk #2: Ephemeral Redis — Catastrophic Session Loss on Restart

**Blast Radius:** 💥💥💥💥 (HIGH — All authenticated users)

**What Redis stores that would be lost:**
- **Refresh tokens** (`refresh:*`) — TTL 7 days. Redis restart = **every user forcibly logged out**. In a payment system during checkout, this is a revenue-impacting event.
- BullMQ webhook jobs — in-flight webhook processing lost (Stripe will re-deliver, so recovery is possible)
- Throttle counters — rate limits reset (temporary blast radius expansion)
- Customer/plan caches — cold start, increased DB load (self-healing)

**Evidence:**
```yaml
redis:
  image: redis:7-alpine
  # NO volumes: — data is purely in-memory
  # NO appendonly yes — no AOF
  # NO save "" — no RDB snapshots
```

**Impact:** A Redis container restart (OOM kill, docker restart, node failure) causes:
1. 100% of active user sessions invalidated instantly
2. All refresh tokens revoked — full re-login required
3. Any in-progress checkout sessions disrupted
4. Rate limiting resets — potential for abuse in the recovery window
5. BullMQ loses in-flight jobs (recovered on Stripe re-delivery)

**Fix:** 
1. Add Redis persistence: `appendonly yes` + volume mount for `appendonly.aof`
2. Or: Store refresh tokens in Oracle (durable, but slower — cache in Redis with DB fallback)
3. Add Redis Sentinel or at minimum a `restart: always` policy
4. Implement graceful degradation: catch Redis errors in `TokenService.validateRefreshToken()` and fall back to requiring re-login with a clear error message (already partially handled via try/catch in `RedisService.get()`)

---

### 🔴 Risk #3: Single Oracle XE Instance — No Scaling Path

**Blast Radius:** 💥💥💥💥 (HIGH — Entire application)

**Constraints:**
- Oracle XE: 2 CPU max, 2GB RAM max, 12GB user data max
- Single instance — no read replicas, no failover
- All queries (reads + writes) hit this one instance
- Oracle-specific SQL throughout (SYSDATE, ROWNUM, :1 binds)

**Impact:**
- **Capacity ceiling:** 12GB user data is the hard limit. Webhook events table (CLOB payloads) will grow rapidly.
- **No read scaling:** Reporting queries (revenue by month, cohort LTV, churn) run against the same instance as payment processing. A heavy reporting query could block payment operations.
- **No failover:** Oracle XE going down = complete application outage. No standby, no replica promotion.
- **Licensing trap:** Oracle XE is free but production Oracle licenses are expensive. No migration path to PostgreSQL without rewriting all repositories.

**Evidence:**
- `SubscriptionsRepository`: Complex queries with `OFFSET/FETCH NEXT` on the primary
- `ReportingRepository`: Aggregation queries (SUM, COUNT, GROUP BY) with no read replica
- `STRIPE_WEBHOOK_EVENTS` table: CLOB payload, no partitioning, no archival strategy — unbounded growth

**Fix (in priority order):**
1. Add table partitioning to `STRIPE_WEBHOOK_EVENTS` by month
2. Add a retention policy (archive/delete events older than 90 days)
3. Plan PostgreSQL migration: abstract repository SQL behind a dialect layer, or use an ORM query builder
4. Add read replica support for reporting queries
5. Add connection pool metrics (Prometheus) to detect saturation before it fails

---

### 🟡 Risk #4: No Metrics or Alerting — Silent Failures in Production

**Blast Radius:** 💥💥💥 (MEDIUM — Delayed incident detection)

**What you can't observe:**
- Webhook processing failure rate (BullMQ job failures after 3 retries are silently lost)
- Oracle connection pool saturation
- Redis connection failures and their impact on throttling/caching/sessions
- API error rate by endpoint, status code, or Stripe error type
- P95/P99 latency for payment creation endpoints
- Webhook end-to-end latency (Stripe send → BullMQ process → DB write)
- `unhandledRejection` handler in `main.ts` calls `process.exit(1)` — a single unhandled rejection **kills the entire API process**

**Evidence:**
```typescript
// main.ts
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
  process.exit(1);  // ← Kills the process. No graceful shutdown. No alert.
});
```

**Impact:**
- Payment failures discovered by customers, not operators
- DB pool exhaustion causes cascading timeouts with no early warning
- Webhook failures accumulate silently (Stripe retries for 3 days, then gives up)
- Process exit on unhandled rejection is a self-inflicted DoS — any uncaught promise rejection takes down the entire API

**Fix:**
1. Add `@nestjs/prometheus` or `prom-client` with a `/metrics` endpoint
2. Export: request duration histogram, error counter by status code, DB pool metrics, BullMQ queue depth, Redis hit rate
3. Add Sentry (`@sentry/nestjs`) for error aggregation and alerting
4. Replace `process.exit(1)` in unhandledRejection with graceful shutdown + alarm
5. Add Grafana dashboard with the critical metrics above
6. Configure alerts: webhook failure rate > 5%, DB pool utilization > 80%, API 5xx rate > 1%, P95 latency > 2s

---

### 🟡 Risk #5: No Multi-Provider Abstraction Layer

**Blast Radius:** 💥💥 (MODERATE — Future flexibility, not immediate production risk)

**The architecture is Stripe-through-and-through:**
- 6 domain services call `stripeService.xxx.create()` directly
- 7 webhook handlers process `Stripe.Event` objects
- 8 entities have `STRIPE_` prefixed table names
- `StripeService` is `@Global()` — implicit dependency everywhere
- Webhook signature verification is Stripe-specific HMAC
- Error types, idempotency mechanism, and metadata format are all Stripe-specific

**Impact if you need to add a second provider:**
- Every service needs a provider abstraction layer
- Every webhook handler needs provider routing
- Every entity needs a provider column + provider-agnostic equivalent
- Database schema migration across all 8 entities
- Full regression test of entire payment flow for both providers
- Estimated: 8-12 weeks of engineering effort

**Is this a problem today?** No — if Stripe is the only planned provider and the business isn't diversifying in the next 12 months. But the architectural cost of deferring this is that every new feature deepens the coupling. The longer you wait, the more expensive the extraction becomes.

**Fix (if needed within 12 months):**
1. Define a `PaymentProvider` interface with the operations you need
2. Wrap `StripeService` in a `StripePaymentProvider implements PaymentProvider`
3. Introduce a `ProviderFactory` that selects the provider by config
4. Refactor one service at a time to use the interface (start with `PaymentIntentsService`)
5. Add provider column to entities incrementally (not a big-bang migration)
6. Route webhooks by endpoint path (`/webhooks/stripe`, `/webhooks/adyen`) with provider-specific guards

---

## 10. Correction to CODE_QUALITY_REPORT.md

The CODE_QUALITY_REPORT.md contains an outdated finding:

> **P0-3: No refresh tokens — users silently lose session after 15 minutes**

**This has been fixed.** The code now includes:
- `TokenService` with `issueTokenPair()`, `validateRefreshToken()`, `revokeRefreshToken()`
- `AuthService.refresh()` with proper token rotation (revoke old → issue new)
- `POST /auth/refresh` endpoint with silent retry in the frontend `api-client.ts`
- Refresh tokens stored in Redis with 7-day TTL
- Frontend `api-client.ts` does silent refresh on 401 with one retry
- httpOnly cookies for both `auth_token` and `refresh_token`

**However, this fix introduces the Redis dependency for session persistence (see Risk #2 above).**

---

## 11. Additional Findings

### 11.1 `withTransaction()` Usage Is Inconsistent

The `transaction.helper.ts` provides a clean `withTransaction()` wrapper. But usage is inconsistent:

| Repository | Uses `withTransaction()`? |
|------------|--------------------------|
| `CustomersRepository.insert()` | ✅ Yes |
| `SubscriptionsRepository.insert()` | ✅ Yes |
| `PaymentIntentsRepository.insert()` | ❌ No |
| `SetupIntentsRepository.insert()` | ❌ No (verified by source analysis) |

The payment and setup intent repositories are the highest-risk write paths (real money) and lack transaction protection.

### 11.2 `customer.deleted` Webhook Handler Has Dead Code

In `CustomerHandler.handle()`:
```typescript
case 'customer.deleted':
  const localCustomer = await this.customersService.findByStripeId(customer.id);
  localCustomer.isDeleted = true;  // ← Mutates in-memory object only!
  // No repo.softDelete() call. No DB update.
```

The customer is marked as deleted in memory only. The deletion is logged but never persisted to Oracle.

### 11.3 Database Module Pool Config Discrepancy

The TECH_STACK_ANALYSIS.md reports `poolMin: 2, poolMax: 10`, but the actual `database.module.ts` has `poolMin: 5, poolMax: 20`. The actual configuration is more generous but still lacks observability.

### 11.4 Stripe API Version Drift

The configuration defaults to `STRIPE_API_VERSION = '2026-03-25.dahlia'`. As of May 2026, this version would be recently released. However, the Stripe SDK v17.4.0 was built for API version `2025-04-30`. Using a future API version with an older SDK could cause type mismatches or unexpected behavior. Verify compatibility.

### 11.5 No WebSocket/Real-Time Updates

No Socket.IO or WebSocket gateway exists. The frontend relies on polling (RTK Query cache invalidation) or page refreshes to see payment status updates. For a payment system, real-time status updates via WebSocket would significantly improve UX during checkout flows (show "processing..." → "payment confirmed!" without polling).

### 11.6 No Idempotency Key Generator Utility

Every service generates idempotency keys by accepting them as a controller parameter from the `@IdempotencyKey()` decorator. But there's no utility to generate one — the frontend must provide it. If the frontend fails to send an idempotency key, one is not auto-generated. This means the frontend must be intimately aware of idempotency semantics.

---

## 12. Recommendations by Priority

### Immediate (Before Any Real Traffic)

1. **Add transactional boundaries to PaymentIntents and SetupIntents repositories** (Risk #1)
2. **Add Redis persistence** — at minimum `appendonly yes` + volume mount (Risk #2)
3. **Replace `process.exit(1)` in unhandledRejection handler** (Risk #4)
4. **Fix `customer.deleted` handler** to actually persist the deletion (Section 11.2)
5. **Add Prometheus metrics endpoint** with basic RED metrics (Rate, Errors, Duration) (Risk #4)

### Short-Term (1-2 Sprints)

6. **Add Sentry error tracking** (`@sentry/nestjs` + `@sentry/nextjs`)
7. **Add DB pool metrics and connection health dashboard**
8. **Add BullMQ queue depth monitoring and dead-letter queue for failed webhooks**
9. **Add table partitioning for STRIPE_WEBHOOK_EVENTS** with 90-day retention
10. **Verify Stripe API version compatibility** (Section 11.4)

### Medium-Term (1-3 Months)

11. **Plan PostgreSQL migration path** — abstract repository SQL behind a database dialect layer
12. **Create production Docker Compose override** with proper resource limits, restart policies, and secrets management
13. **Add read replica support for reporting queries**
14. **Evaluate whether multi-provider abstraction is needed** based on business roadmap
15. **Add WebSocket gateway for real-time payment status updates**

### Long-Term (3-6 Months)

16. **Implement circuit breaker for Redis and Stripe API calls** (e.g., `opossum` or `cockatiel`)
17. **Add end-to-end integration test suite** covering the full payment flow
18. **Replace Jaeger with production-grade tracing** (Grafana Tempo, SigNoz, or Datadog APM)
19. **Oracle → PostgreSQL migration** if warranted by scale and licensing
20. **CI/CD pipeline** with automated testing, linting, and deployment gates

---

*End of Systems Architecture Analysis*
