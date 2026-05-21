# Webhooks App — Comprehensive Inventory

## 1. What Is This Webhooks App?

`apps/webhooks` is a **dedicated, standalone NestJS microservice** for receiving and processing inbound webhook callbacks from **Stripe** and **TrustID Cloud**. It is NOT the main API app (`apps/api`), which also has some webhook handling built in. The monorepo has three apps:

| App | Purpose |
|-----|---------|
| `apps/api` | Main API (NestJS) — handles user-facing endpoints, webhooks fallback |
| `apps/webhooks` | **Dedicated webhook microservice** (NestJS) — Stripe + TrustID |
| `apps/web` | Next.js frontend |

### Is it NestJS? Yes.

Both `apps/webhooks` and `apps/api` are NestJS applications. The webhooks app configures itself as:

- **Port**: `3002` (separate from the main API)
- **Global prefix**: `api/v1`
- **No auth guards** — all endpoints are `@Public()`
- **No throttler** — webhooks must never be rate-limited
- **No health/metrics/reporting** modules
- **CORS**: `*` (only POST/OPTIONS)
- **Observability**: OpenTelemetry (traces + metrics → Grafana LGTM)
- **Logging**: Pino → stdout + files → Loki via Alloy

**Important**: The TypeScript source files in `apps/webhooks/src/` are currently **empty stubs** (only directory structure exists: `src/common/decorators/`, `src/common/guards/`, `src/config/`, `src/webhooks/handlers/`). The actual working code lives in the **compiled output** at `apps/webhooks/dist/`. The source may need to be regenerated or migrated. Meanwhile, `apps/api/src/webhooks/` contains the **full TypeScript source** — the same logic but integrated into the main API app (with `@Public()`, `@SkipThrottle()` decorators because the API app HAS auth guards and throttling).

### Key architectural difference: `apps/webhooks` vs `apps/api/src/webhooks/`

| Aspect | `apps/webhooks` (standalone) | `apps/api` (integrated) |
|--------|------------------------------|-------------------------|
| Source code | Compiled JS only (`dist/`) | Full TypeScript source |
| Auth | None (no guards installed) | Uses `@Public()` to bypass auth |
| Throttling | None (no module installed) | Uses `@SkipThrottle()` to bypass |
| Domain services | Imports from `@stripe-integration/domain` shared package | Uses local `../trust/`, `../s3/` module imports |
| Database | Oracle via shared `DatabaseModule` | Oracle via TypeORM local DataSource |
| Purpose | Production webhook endpoint | Development/fallback |

---

## 2. App Module Structure

### `apps/webhooks` — AppModule (`app.module.js`)
```
AppModule
├── ConfigModule (global, loads configuration() + validationSchema)
├── DatabaseModule (from @stripe-integration/domain)
├── RedisModule (from @stripe-integration/domain)
├── WebhooksModule (Stripe webhooks)
└── TrustIdWebhookModule (TrustID webhooks)
```

### `apps/webhooks` — WebhooksModule (`webhooks.module.js`)
```
WebhooksModule
├── Imports
│   ├── BullModule.forRootAsync (Redis connection)
│   ├── BullModule.registerQueue('stripe-webhooks')
│   ├── BullModule.registerQueue('stripe-webhooks-dlq')
│   ├── CustomersModule
│   ├── PaymentIntentsModule
│   ├── SetupIntentsModule
│   ├── PaymentMethodsModule
│   ├── SubscriptionsModule
│   ├── AuditModule
│   └── TrustModule
├── Controllers
│   └── WebhooksController
└── Providers
    ├── WebhooksService
    ├── WebhooksRepository
    ├── WebhookProcessor (BullMQ worker)
    ├── PaymentIntentHandler
    ├── SetupIntentHandler
    ├── SubscriptionHandler
    ├── InvoiceHandler
    ├── PaymentMethodHandler
    ├── CustomerHandler
    ├── MandateHandler
    ├── ChargeHandler
    ├── RadarHandler
    ├── AccountHandler
    ├── CheckoutSessionHandler
    └── WebhookSignatureGuard
```

### `apps/webhooks` — TrustIdWebhookModule (`trustid-webhook.module.js`)
```
TrustIdWebhookModule
├── Imports
│   ├── TrustModule
│   ├── TrustIdModule
│   ├── S3Module
│   ├── ConfigModule
│   ├── BullModule.registerQueue('trustid-webhooks')
│   └── BullModule.registerQueue('trustid-webhooks-dlq')
├── Controllers
│   └── TrustIdWebhookController
└── Providers
    ├── TrustIdContainerHandler
    ├── TrustIdResultHandler
    └── TrustIdWebhookProcessor (BullMQ worker)
```

---

## 3. Infrastructure — BullMQ Queues

The webhooks app uses **BullMQ** backed by Redis for async processing with retry + dead-letter queuing.

### Queue: `stripe-webhooks` (Stripe webhook events)
| Setting | Value |
|---------|-------|
| Max attempts | 3 |
| Backoff | Exponential, 5s delay |
| Complete job TTL | 7 days |
| Failed job TTL | 30 days |

### Queue: `stripe-webhooks-dlq` (Dead Letter Queue)
| Setting | Value |
|---------|-------|
| Complete job TTL | Never (kept indefinitely) |
| Failed job TTL | Never |

### Queue: `trustid-webhooks` (TrustID Stop webhooks)
| Setting | Value |
|---------|-------|
| Max attempts | 5 |
| Backoff | Exponential, 10s delay |
| Complete job TTL | 7 days |
| Failed job TTL | 30 days |

### Queue: `trustid-webhooks-dlq` (Dead Letter Queue)
| Setting | Value |
|---------|-------|
| Complete job TTL | Never |
| Failed job TTL | Never |

---

## 4. Common Infrastructure

### Decorators
- **`StripeEvent`** (`common/decorators/stripe-event.decorator.ts`): Extracts verified Stripe event from `request.stripeEvent` (set by the signature guard).

### Guards
- **`WebhookSignatureGuard`** (`common/guards/webhook-signature.guard.ts`): Verifies Stripe webhook signatures using `stripe.webhooks.constructEvent()`. Requires `rawBody`, `stripe-signature` header, and `STRIPE_WEBHOOK_SECRET`.

---

## 5. ALL Stripe Webhook Events Handled (Complete Inventory)

These are registered in the `handlerRegistry` Map inside `WebhooksService` constructor. **39 event types total** across 11 handler classes.

### PaymentIntent (6 events) → `PaymentIntentHandler`
| Event Type | Action |
|------------|--------|
| `payment_intent.succeeded` | Update status → `succeeded` |
| `payment_intent.payment_failed` | Update status → `requires_payment_method` with error details |
| `payment_intent.canceled` | Update status → `canceled` |
| `payment_intent.processing` | Update status → `processing` with next_action + amount_received |
| `payment_intent.requires_action` | Update status → `requires_action` |
| `payment_intent.amount_capturable_updated` | Log only |

### SetupIntent (4 events) → `SetupIntentHandler`
| Event Type | Action |
|------------|--------|
| `setup_intent.succeeded` | Update status → `succeeded` + payment_method |
| `setup_intent.setup_failed` | Update status → `requires_payment_method` with error |
| `setup_intent.canceled` | Update status → `canceled` |
| `setup_intent.requires_action` | Update status → `requires_action` |

### Subscription (8 events) → `SubscriptionHandler`
| Event Type | Action |
|------------|--------|
| `customer.subscription.created` | Full sync from Stripe |
| `customer.subscription.updated` | Full sync from Stripe |
| `customer.subscription.deleted` | Full sync from Stripe |
| `customer.subscription.trial_will_end` | Sync + log notification prompt |
| `customer.subscription.paused` | Full sync from Stripe |
| `customer.subscription.resumed` | Full sync from Stripe |
| `customer.subscription.pending_update_applied` | Full sync + log |
| `customer.subscription.pending_update_expired` | Log only |

### Invoice (8 events) → `InvoiceHandler`
| Event Type | Action |
|------------|--------|
| `invoice.created` | Log only |
| `invoice.finalized` | Log only |
| `invoice.payment_succeeded` | Log; if subscription → mark active |
| `invoice.payment_failed` | If subscription → mark `past_due` |
| `invoice.upcoming` | Log only |
| `invoice.paid` | If subscription was `past_due` → reactivate to `active` |
| `invoice.voided` | Log only |
| `invoice.marked_uncollectible` | If subscription → mark `unpaid` |

### PaymentMethod (4 events) → `PaymentMethodHandler`
| Event Type | Action |
|------------|--------|
| `payment_method.attached` | Upsert from Stripe |
| `payment_method.detached` | Remove by Stripe ID |
| `payment_method.updated` | Upsert from Stripe |
| `payment_method.card_automatically_updated` | Upsert + log card updater details |

### Customer (5 events) → `CustomerHandler`
| Event Type | Action |
|------------|--------|
| `customer.created` | Log (possibly external creation) |
| `customer.updated` | Sync from Stripe |
| `customer.deleted` | Soft delete in local DB |
| `customer.discount.created` | Log with coupon details |
| `customer.discount.deleted` | Log with coupon details |

### Mandate (1 event) → `MandateHandler`
| Event Type | Action |
|------------|--------|
| `mandate.updated` | Re-sync associated PaymentMethod from Stripe |

### Charge (6 events) → `ChargeHandler`
| Event Type | Action |
|------------|--------|
| `charge.succeeded` | Log only |
| `charge.failed` | Log + audit trail entry |
| `charge.refunded` | Log only |
| `charge.dispute.created` | Log + audit trail entry |
| `charge.dispute.closed` | Log + audit trail entry (won/lost) |
| `charge.dispute.updated` | Log + audit trail entry with changed fields |

### Radar (1 event) → `RadarHandler`
| Event Type | Action |
|------------|--------|
| `radar.early_fraud_warning` | Log + audit trail entry |

### Account (1 event) → `AccountHandler`
| Event Type | Action |
|------------|--------|
| `account.updated` | Log + audit trail entry with changed capabilities |

### Checkout Session (3 events) → `CheckoutSessionHandler`
| Event Type | Action |
|------------|--------|
| `checkout.session.completed` | If `metadata.trustId` → auto-approve trust token |
| `checkout.session.async_payment_succeeded` | Same as completed |
| `checkout.session.expired` | Log only |

---

## 6. ALL TrustID Webhook Events Handled (Complete Inventory)

TrustID webhooks hit a **single endpoint**: `POST /api/v1/webhooks/trustid`

Routing is based on **`WorkflowName`** first, then **`WorkflowState`**.

### 6.1 AutoReferral Workflow

#### WorkflowState = "Start" → Container Submitted
- **Handler**: `TrustIdContainerHandler` (handled inline, fire-and-forget)
- **Action**: Extract `ContainerId` from `Callback.WorkflowStorage`, look up trust token by `resourceId`, mark token status → `'submitted'`

#### WorkflowState = "Stop" → Verification Complete
- **Handler**: Enqueued to BullMQ → `TrustIdWebhookProcessor`
- **Action**: 
  1. Look up trust token by `containerId`
  2. Retrieve full document container from TrustID API
  3. Pull all document images, store in S3: `users/{userId}/trust-approved/{containerId}/documents/{imageId}.{ext}`
  4. Generate PDF report, store in S3: `users/{userId}/trust-approved/{containerId}/report.pdf`
  5. Store assessment metadata JSON: `users/{userId}/trust-approved/{containerId}/assessment.json`
  6. Determine token status based on DBS status mapping
  7. Update trust token status + metadata with DBS interpretation

### 6.2 UpdateDocument Workflow

#### WorkflowState = "Start" → Post-Result Document Update
- **Handler**: `TrustIdWebhookController.handleUpdateDocument()` (inline)
- **Action**: **Log only**. No token state change — documents were modified after processing. Re-processing would overwrite verified files with modified ones.

### 6.3 Unknown WorkflowName
- **Action**: Log warning, return `{ received: true }`

---

## 7. Data Flow

### Stripe Webhook Pipeline
```
Stripe Cloud
  ↓ POST /api/v1/webhooks/stripe (rawBody)
WebhookSignatureGuard
  ↓ Verify signature via Stripe SDK
  ↓ Attach stripeEvent to request
StripeEvent decorator
  ↓ Extract Stripe.Event
WebhooksController.handleStripeWebhook()
  ↓
WebhooksService.processEvent()
  ↓ Deduplicate (skip if already processed)
  ↓ Encrypt payload
  ↓ DB insert/update (STRIPE_WEBHOOK_EVENTS table, Oracle)
  ↓ Enqueue to BullMQ 'stripe-webhooks'
  ↓ Return 200 to Stripe immediately
WebhookProcessor (BullMQ worker)
  ↓ Dequeue job
  ↓ WebhooksService.execute()
    ↓ Decrypt payload
    ↓ handlerRegistry.get(event.type) → dispatch
      ↓ Handler.handle(event) — see handlers above
    ↓ Mark processed/failed in DB
  ↓ On final failure → DLQ 'stripe-webhooks-dlq'
```

### TrustID Webhook Pipeline
```
TrustID Cloud
  ↓ POST /api/v1/webhooks/trustid (JSON)
TrustIdWebhookController.handleTrustIdWebhook()
  ↓ Route by WorkflowName + WorkflowState
  
  ── AutoReferral + Start ──
  TrustIdContainerHandler.handle()
    ↓ Look up token by containerId
    ↓ Update status → 'submitted'
    ↓ Return 200
    
  ── AutoReferral + Stop ──
  Enqueue to BullMQ 'trustid-webhooks'
    ↓ Return 200
  TrustIdWebhookProcessor (BullMQ worker)
    ↓ Dequeue job
    ↓ pullAndStore(containerId)
      ↓ Look up trust token
      ↓ TrustID API: retrieveDocumentContainer
      ↓ TrustID API: retrieveImage (per image)
      ↓ S3 upload (per image)
      ↓ TrustID API: exportPDF
      ↓ S3 upload (PDF report)
      ↓ S3 upload (assessment.json)
      ↓ DBS status → token status mapping
      ↓ Update token status + metadata
    ↓ On final failure → DLQ 'trustid-webhooks-dlq'
    
  ── UpdateDocument + Start ──
  Log only → Return 200
```

---

## 8. Key Files Reference

### `apps/webhooks/dist/` (compiled — production code)
| File | Purpose |
|------|---------|
| `main.js` | Bootstrap: NestJS app, helmet, cors, graceful shutdown |
| `app.module.js` | Root module |
| `instrumentation.js` | OpenTelemetry SDK setup |
| `config/configuration.js` | Config (port 3002, OTEL service name 'stripe-webhooks') |
| `webhooks/webhooks.module.js` | Stripe webhook module |
| `webhooks/webhooks.controller.js` | `POST /api/v1/webhooks/stripe` |
| `webhooks/webhooks.service.js` | Core: processEvent, execute, dispatch, handlerRegistry |
| `webhooks/webhook.processor.js` | BullMQ worker (stripe-webhooks queue) |
| `webhooks/webhooks.repository.js` | Oracle DB CRUD (STRIPE_WEBHOOK_EVENTS) |
| `webhooks/webhook-queue.constants.js` | Queue name constants |
| `webhooks/trustid-webhook.module.js` | TrustID webhook module |
| `webhooks/trustid-webhook.controller.js` | `POST /api/v1/webhooks/trustid` |
| `webhooks/trustid-webhook.processor.js` | BullMQ worker (trustid-webhooks queue) |
| `webhooks/trustid-webhook-queue.constants.js` | Queue name constants |
| `webhooks/handlers/payment-intent.handler.js` | Stripe PI handler |
| `webhooks/handlers/setup-intent.handler.js` | Stripe SI handler |
| `webhooks/handlers/subscription.handler.js` | Stripe subscription handler |
| `webhooks/handlers/invoice.handler.js` | Stripe invoice handler |
| `webhooks/handlers/payment-method.handler.js` | Stripe PM handler |
| `webhooks/handlers/customer.handler.js` | Stripe customer handler |
| `webhooks/handlers/mandate.handler.js` | Stripe mandate handler |
| `webhooks/handlers/charge.handler.js` | Stripe charge/dispute handler |
| `webhooks/handlers/radar.handler.js` | Stripe Radar handler |
| `webhooks/handlers/account.handler.js` | Stripe account handler |
| `webhooks/handlers/checkout-session.handler.js` | Stripe checkout handler |
| `webhooks/handlers/trustid-container.handler.js` | TrustID container submitted |
| `webhooks/handlers/trustid-result.handler.js` | TrustID result notification |
| `common/decorators/stripe-event.decorator.js` | `@StripeEvent()` param decorator |
| `common/guards/webhook-signature.guard.js` | Stripe signature verification guard |

### `apps/api/src/webhooks/` (TypeScript source — same logic, integrated into API)
| File | Purpose |
|------|---------|
| `webhooks.module.ts` | Stripe webhook module (with BullMQ + domain modules) |
| `webhooks.controller.ts` | `POST /api/v1/webhooks/stripe` (`@Public()`, `@SkipThrottle()`) |
| `webhooks.service.ts` | Core: processEvent, execute, dispatch, handlerRegistry |
| `webhook.processor.ts` | BullMQ worker |
| `webhooks.repository.ts` | Oracle DB CRUD |
| `webhook-queue.constants.ts` | Queue constants |
| `trustid-webhook.module.ts` | TrustID webhook module |
| `trustid-webhook.controller.ts` | `POST /api/v1/webhooks/trustid` |
| `trustid-webhook.processor.ts` | BullMQ worker (S3 pull pipeline) |
| `trustid-webhook-queue.constants.ts` | Queue constants |
| `handlers/*.handler.ts` | 14 handler files (11 Stripe + 2 TrustID + 3 spec files) |

### `apps/api/src/stripe/`
| File | Purpose |
|------|---------|
| `stripe.module.ts` | `@Global()` module exporting `StripeService` |
| `stripe.service.ts` | Stripe SDK wrapper: customers, paymentIntents, setupIntents, paymentMethods, subscriptions, webhooks, etc. + `constructWebhookEvent()` |

---

## 9. Dependencies & External Services

| Service | Used By | Purpose |
|---------|---------|---------|
| **Stripe API** | `StripeService` (domain) | SDK client for all Stripe operations |
| **TrustID Cloud** | `TrustIdService` (domain) | retrieveDocumentContainer, retrieveImage, exportPDF |
| **Redis** | BullMQ | Queue backend for async webhook processing |
| **Oracle DB** | `WebhooksRepository` | `STRIPE_WEBHOOK_EVENTS` table |
| **S3** | TrustID webhook processor | Store verified documents/reports/assessments |
| **Grafana LGTM** | OpenTelemetry SDK | Traces → Tempo, Metrics → Prometheus, Logs → Loki |

---

## 10. Start Here (for another agent)

Open `apps/api/src/webhooks/webhooks.service.ts` — this is the central dispatch hub containing the complete `handlerRegistry` Map with all 39 Stripe event type mappings plus the full `processEvent` / `execute` / `dispatch` pipeline. The TypeScript source is in `apps/api/src/webhooks/`; the identical compiled version is in `apps/webhooks/dist/webhooks/`.

For TrustID, start with `apps/api/src/webhooks/trustid-webhook.controller.ts` — this shows the WorkflowName/WorkflowState routing logic and the inline-vs-BullMQ split.
