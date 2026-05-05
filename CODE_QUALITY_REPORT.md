# Code Quality Report

**Generated:** 2026-05-05  
**Scope:** Full-stack production-readiness audit  
**Methodology:** Static analysis + architectural review + security audit  

---

## Overall Health Score: 6.5 / 10

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture | 8/10 | Clean module boundaries, proper DI, filters/guards correct |
| Code style | 8/10 | Consistent, typed, raw SQL preferred |
| Security | 6/10 | Auth functional but incomplete; CSP gap on frontend |
| Performance | 7/10 | Good indexes, caching added; cache lacks resilience |
| Test coverage | 1/10 | No test files found anywhere in the codebase |
| Data integrity | 5/10 | Critical FK gaps in schema |
| Operational | 7/10 | Good logging/tracing; no metrics endpoint |

---

## P0 — Fix Before Any Real Users

### P0-1: Redis failures crash cached endpoints

**File:** `apps/api/src/redis/redis.service.ts`  
**File:** `apps/api/src/customers/customers.service.ts`  

`RedisService.get()` and `set()` call ioredis directly with no error handling. If Redis is unavailable, every request to `GET /customers/:id`, `GET /customers/stripe/:id`, and `GET /subscriptions/plans` throws an uncaught exception and returns HTTP 500 instead of gracefully falling back to the database.

```typescript
// ❌ Current — Redis down = 500 on every customer lookup
async get<T>(key: string): Promise<T | null> {
  const val = await this.client.get(key);
  return val ? (JSON.parse(val) as T) : null;
}

// ✅ Fix — silent fallback, log the error, continue
async get<T>(key: string): Promise<T | null> {
  try {
    const val = await this.client.get(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch (err) {
    this.logger.error({ message: 'Redis get failed, cache miss', key, err });
    return null;
  }
}

async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const s = JSON.stringify(value);
    ttlSeconds ? await this.client.setex(key, ttlSeconds, s)
               : await this.client.set(key, s);
  } catch (err) {
    this.logger.warn({ message: 'Redis set failed, skipping cache', key, err });
  }
}
```

**Impact:** Production outage if Redis restarts or has a network blip.

---

### P0-2: NEXT_PUBLIC_DEMO_CUSTOMER_ID hardcoded in payment-methods page

**File:** `apps/web/src/app/payment-methods/page.tsx`  

The payment methods page uses `process.env.NEXT_PUBLIC_DEMO_CUSTOMER_ID` to identify the customer. Every user in the app sees and manages the same demo customer's payment methods. There's no user→customer mapping on the frontend.

This is the exact same issue as "ownership verification" (P2 in prior doc) but it's actually worse — the frontend is hardcoded to one customer ID entirely.

**Fix:** After implementing refresh tokens and user-customer FK, derive `customerId` from the authenticated user's JWT payload, not an env var.

---

### P0-3: No refresh tokens — users silently lose session after 15 minutes

**File:** `apps/api/src/auth/auth.service.ts`  
**File:** `apps/api/src/config/configuration.ts:29`  

```typescript
expiresIn: '15m'  // hardcoded
```

There is no refresh token, no `POST /auth/refresh` endpoint, and no token rotation. After 15 minutes:
- RTK Query calls return 401
- Server actions return 401  
- The user is silently locked out with no redirect to login
- The httpOnly cookie also expires, so there's no recovery path without a full re-login

**Fix:** Issue a short-lived access token (15m) paired with a long-lived refresh token (7d) stored in httpOnly cookie. Add `POST /auth/refresh` and token rotation. Use Redis for refresh token storage/revocation.

---

## P1 — Fix This Sprint

### P1-1: No database transaction wrapping Stripe API + DB insert

**Files:** All service files — `customers.service.ts`, `payment-intents.service.ts`, `subscriptions.service.ts`, etc.

Every "create" operation follows the pattern:
```
1. Check idempotency in DB
2. Call Stripe API → creates resource (irreversible)
3. INSERT into DB (can fail)
```

If step 3 fails (Oracle connection issue, constraint violation), the Stripe resource exists but the local DB has no record. The customer/payment-intent exists in Stripe but is invisible to the application.

```typescript
// ❌ Current — no transaction
const stripeCustomer = await this.stripeService.customers.create(...);
await this.dataSource.query('INSERT INTO STRIPE_CUSTOMERS ...', [...]);

// ✅ Fix — wrap DB operations in transaction; accept Stripe as the source of truth
await this.dataSource.transaction(async (manager) => {
  // idempotency check inside transaction
  // INSERT inside transaction
  // if insert fails → transaction rolls back; next retry via idempotency key will re-fetch from Stripe
});
```

The idempotency key pattern already handles Stripe-side deduplication. The gap is the local DB write atomicity.

---

### P1-2: No user→customer ownership enforcement

**Files:** All controllers — no JWT user validated against customer ownership.

The JWT gives you `{ id, email }`. There is no FK between `APP_USERS` and `STRIPE_CUSTOMERS`. Any authenticated user can call:
- `GET /customers/:anyId` — read any customer's data
- `GET /payment-methods/customer/:anyCustomerId` — read any customer's cards
- `GET /subscriptions/customer/:anyCustomerId` — read anyone's subscriptions

**Fix (2 steps):**
1. Migration: add `USER_ID` column + FK to `STRIPE_CUSTOMERS`
2. Controller guard: compare `req.user.id` against `customer.userId` in every customer-scoped operation

---

### P1-3: Missing FK from STRIPE_SUBSCRIPTIONS to SUBSCRIPTION_PLANS

**File:** `apps/api/src/database/migrations/`  

`STRIPE_SUBSCRIPTIONS.STRIPE_PRICE_ID` is a plain `VARCHAR2`. `SUBSCRIPTION_PLANS` can be deleted while active subscriptions reference it. Reporting queries that join these tables will produce null/broken data.

```sql
-- Add to new migration
ALTER TABLE STRIPE_SUBSCRIPTIONS 
  ADD CONSTRAINT FK_SUB_PLAN 
  FOREIGN KEY (STRIPE_PRICE_ID) 
  REFERENCES SUBSCRIPTION_PLANS(STRIPE_PRICE_ID) 
  ON DELETE RESTRICT;
```

---

### P1-4: In-memory throttler breaks with multiple API replicas

**File:** `apps/api/src/app.module.ts:39`  

`@nestjs/throttler` defaults to an in-memory counter. Each API instance tracks its own counts independently. Running 2 replicas means the effective rate limit is `2 × configured_limit`. At 3 replicas, it's `3×`.

**Fix:** Add `@nestjs-throttler-storage-redis` and configure `ThrottlerModule` with the `RedisService`:

```typescript
ThrottlerModule.forRootAsync({
  useFactory: (config: ConfigService, redis: RedisService) => ({
    throttlers: [...],
    storage: new ThrottlerStorageRedisService(redis.client),
  }),
})
```

---

### P1-5: findByStripeId caches incomplete customer object

**File:** `apps/api/src/customers/customers.service.ts`  

`findById()` returns customer + payment methods + subscriptions, stored under `customer:{id}`.  
`findByStripeId()` returns only the bare customer row (no nested relations), stored under `customer:stripe:{stripeId}`.

Webhook handlers call `findByStripeId()` → get a customer object without `paymentMethods` or `subscriptions`. If that result is then passed to code expecting the full shape, it silently returns empty arrays instead of actual data.

**Fix:** In `findByStripeId()`, after the DB query, call `findById(customer.id)` to get the full object and cache under both keys.

```typescript
async findByStripeId(stripeCustomerId: string): Promise<StripeCustomer> {
  const cached = await this.redis.get<StripeCustomer>(CacheKeys.customerByStripe(stripeCustomerId));
  if (cached) return cached;
  
  const [row] = await this.dataSource.query<StripeCustomer[]>(...);
  if (!row) throw new NotFoundException(...);
  
  // Get full object (with payment methods + subscriptions)
  const full = await this.findById(row.id);  
  // findById already caches under customer:{id}; also cache the stripe ID lookup
  await this.redis.set(CacheKeys.customerByStripe(stripeCustomerId), full, CacheTtl.CUSTOMER);
  return full;
}
```

---

### P1-6: Reporting endpoints unprotected from expensive query abuse

**File:** `apps/api/src/reporting/reporting.controller.ts`  

Endpoints like `GET /reports/customers/cohort-ltv` execute Oracle window functions with `WITH` clauses, multi-table joins, and `ADD_MONTHS` date math. These run without any query-level rate limiting beyond the global 100/min throttle.

**Fix:**
1. Apply the `payment` throttler (20/min) to all reporting endpoints.
2. Cache report results in Redis with a 5-minute TTL — these are analytics, not real-time.
3. Long-term: move to async job queue (Trigger.dev / BullMQ) for cohort queries.

---

## P2 — Next 2-3 Sprints

### P2-1: LOG_FORMAT not validated by Joi

**File:** `apps/api/src/config/configuration.ts:19`  
**File:** `apps/api/src/config/validation.schema.ts`  

```typescript
// configuration.ts reads this
format: process.env.LOG_FORMAT ?? 'json',

// ...but validation.schema.ts has no LOG_FORMAT entry
// Joi won't validate or transform it — typo goes undetected
```

Add to `validation.schema.ts`:
```typescript
LOG_FORMAT: Joi.string().valid('json', 'pretty').default('json'),
```

---

### P2-2: Email uniqueness on STRIPE_CUSTOMERS is an index, not a constraint

**File:** Migration 002  

`IDX_CUSTOMERS_EMAIL` is a non-unique index used for lookups. There is no `UNIQUE` constraint. Two concurrent requests can pass the email-exists check and both proceed to create customers with the same email.

```sql
-- Add to new migration
ALTER TABLE STRIPE_CUSTOMERS 
  ADD CONSTRAINT UQ_CUSTOMER_EMAIL UNIQUE (EMAIL);
```

---

### P2-3: unsafe-inline in Next.js CSP for script-src

**File:** `apps/web/next.config.mjs`  

```javascript
"script-src 'self' 'unsafe-inline' js.stripe.com ..."
```

`unsafe-inline` in `script-src` defeats XSS protection entirely — any injected `<script>` tag executes. The correct fix for Next.js is nonce-based CSP.

```javascript
// Generate per-request nonce in middleware.ts
// Pass to headers() and to <Script nonce={nonce}>
```

This is not trivial with Next.js App Router but is required for PCI SAQ A+ compliance.

---

### P2-4: No database-level check constraints on status fields

**Files:** All migration files  

`STATUS` columns in `STRIPE_PAYMENT_INTENTS`, `STRIPE_SUBSCRIPTIONS`, `STRIPE_WEBHOOK_EVENTS` are unconstrained `VARCHAR2`. Invalid statuses can be written without DB rejection.

```sql
ALTER TABLE STRIPE_PAYMENT_INTENTS 
  ADD CONSTRAINT CHK_PI_STATUS 
  CHECK (STATUS IN ('pending', 'processing', 'requires_action', 
                    'requires_confirmation', 'requires_capture',
                    'canceled', 'succeeded'));
```

---

### P2-5: listPlans cache has no invalidation path

**File:** `apps/api/src/subscriptions/subscriptions.service.ts`  

Plans are cached for 1 hour. If a plan is deactivated in Stripe and the `SUBSCRIPTION_PLANS` table is updated directly (e.g., via a migration or admin script), the cache continues serving the stale plan list for up to 1 hour.

**Fix:** Add a `POST /api/v1/subscriptions/plans/sync` admin endpoint that syncs from Stripe, updates the DB, and calls `this.redis.del(CacheKeys.plans(true), CacheKeys.plans(false))`.

---

## P3 — Backlog

| ID | Issue | File | Notes |
|----|-------|------|-------|
| P3-1 | No test coverage anywhere | All files | Zero unit tests, zero integration tests, zero E2E tests. This is the largest overall risk. |
| P3-2 | Sentry error tracking absent | All | `@sentry/nestjs` + `@sentry/nextjs` needed for production visibility |
| P3-3 | No Prometheus metrics | `main.ts` | Can't observe request rates, error rates, or DB pool saturation without SigNoz/Datadog agent |
| P3-4 | Oracle XE production licensing | `docker-compose.yml` | XE is free but limited (2 CPU, 2GB RAM, 12GB data). Licensed Oracle or PostgreSQL needed at real scale. |
| P3-5 | No CI/CD pipeline | `.github/` | No automated lint/build/test on pull requests |
| P3-6 | bcrypt vs Argon2id | `auth.service.ts` | bcrypt 12 rounds is acceptable now, but Argon2id is the OWASP-recommended algorithm for new projects |
| P3-7 | Webhook health endpoint needs public access | `reporting.controller.ts` | `GET /reports/webhooks/health` requires JWT — monitoring tools can't call it without auth |
| P3-8 | No archival strategy for STRIPE_WEBHOOK_EVENTS | Schema | Table will grow unbounded; add partition by month or periodic archive job |
| P3-9 | CORS limited to single origin | `validation.schema.ts` | No support for multiple origins or regex matching for staging/preview environments |

---

## Previously Fixed (from prior session)

| ID | Fix | Status |
|----|-----|--------|
| SEC-01 | Customer email PII leak in error messages | ✅ Fixed |
| SEC-02 | Email in plaintext logs | ✅ Fixed |
| SEC-03 | No body size limit (DoS) | ✅ Fixed (100kb limit) |
| SEC-04/05 | Helmet CSP tightened on API | ✅ Fixed |
| SEC-06 | Frontend security headers | ✅ Fixed (next.config.mjs) |
| SEC-07 | ParseUUIDPipe on reporting customerId | ✅ Fixed |
| SEC-08 | checkout searchParams without validation | ✅ Fixed |
| SEC-09/10 | Global JWT guard + RTK Query auth header | ✅ Fixed |
| DB-01 | 9 missing indexes | ✅ Fixed (migration 002) |
| DB-02 | Webhook UPDATED_AT column | ✅ Fixed |
| PERF-01/02 | Unbounded list queries | ✅ Paginated |
| OPS-01 | Unhandled rejection process handler | ✅ Fixed |
| OPS-03 | Swagger setup | ✅ Fixed |
