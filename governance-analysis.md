# Governance & Security Analysis

**Date:** 2026-05-19
**Analyst:** Security & Governance Architecture Lead
**Scope:** Deep-dive audit — NestJS 10 API + Next.js 14 frontend, Oracle XE, Redis, JWT auth
**Prior Reports Reviewed:** `CODE_QUALITY_REPORT.md` (2026-05-05), `security_best_practices_report.md` (2026-05-17)

---

## Executive Summary

The codebase has materially improved since the prior reports. Multiple P0/P1 issues have been addressed: Redis error handling is now defensive (get/set/del), refresh tokens with rotation are implemented, ownership enforcement is wired into all customer-scoped controllers, rate limiting is Redis-backed, email uniqueness is a constraint (not just an index), and status check constraints exist. The webhook pipeline (HMAC verification → idempotency gate → BullMQ async processing → typed handler dispatch) is well-architected.

**However**, there are three critical gaps that remain, two of which were introduced by the very fixes that addressed prior issues. The Redis throttler storage path is unprotected against Redis failure (regression from the fix that wrapped get/set/del), the webhook customer.deleted handler has a dead-write bug, and the STRIPE_SUBSCRIPTIONS → SUBSCRIPTION_PLANS FK was planned but not created.

---

## Prioritized Risk Matrix

### Risk Legend
| Severity | Criteria |
|----------|----------|
| **Critical** | Production outage path, data corruption, or security bypass with no compensating control |
| **High** | Data exposure, integrity gap, or defense-in-depth failure with partial mitigation |
| **Medium** | Degraded resilience, fairness gap, or missing hardening |
| **Low** | Operational friction, future risk, or non-blocking improvement |

---

## CRITICAL

### C-1: Redis Throttler Storage Has No Failure Resilience — Redis Down = 100% Request Failure

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/redis/redis.service.ts:82-100`, `apps/api/src/redis/redis-throttler.storage.ts:14-54` |
| **Root cause** | `RedisService.incr()`, `ttl()`, `expire()`, and `setWithExpiry()` are thin passthroughs to ioredis with **no try/catch**. `RedisThrottlerStorage.increment()` calls all four methods unconditionally. |
| **Prior report context** | `CODE_QUALITY_REPORT.md` P0-1 flagged Redis crash on `get()`/`set()`. That was fixed. But the *throttler path* was missed — it uses different methods that were never wrapped. |

**Evidence — `redis.service.ts:82-100`:**
```typescript
// ❌ These 4 methods are called by the throttler on EVERY request and have NO error handling
async incr(key: string): Promise<number> {
    return this.client.incr(key);       // throws if Redis unreachable
}
async ttl(key: string): Promise<number> {
    return this.client.ttl(key);         // throws if Redis unreachable
}
async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);  // throws if Redis unreachable
}
async setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);  // throws if Redis unreachable
}
```

**Evidence — `redis-throttler.storage.ts:14-54`:**
```typescript
async increment(key, ttl, limit, blockDuration, _throttlerName) {
    const blockTtl = await this.redis.ttl(blockKey);        // 💥 uncaught
    if (blockTtl > 0) { /* short-circuit */ }
    const totalHits = await this.redis.incr(hitKey);         // 💥 uncaught
    if (totalHits === 1) {
        await this.redis.expire(hitKey, ...);                 // 💥 uncaught
    }
    if (totalHits > limit) {
        await this.redis.setWithExpiry(blockKey, ...);       // 💥 uncaught
    }
    // ...
}
```

**Exploitation/Failure scenario:**
1. Redis restarts, network blip, or memory pressure causes connection drop.
2. Every HTTP request hits `ThrottlerGuard` → `RedisThrottlerStorage.increment()`.
3. ioredis throws `ConnectionClosedError` or `MaxRetriesPerRequestError`.
4. NestJS global exception filter catches it → HTTP 500 on **every** endpoint.
5. This includes webhook endpoints (which bypass JWT but NOT ThrottlerGuard).

Wait — does the webhook endpoint bypass ThrottlerGuard? Let me check: `WebhooksController` is decorated with `@Public()` which bypasses `JwtAuthGuard`, but `ThrottlerGuard` is registered as `APP_GUARD` independently. The webhook controller has NO `@SkipThrottle()` or `@Throttle()` decorator that would bypass it. **The Stripe webhook endpoint WILL be affected by this outage.** Stripe will see 500s, retry, and eventually disable the webhook endpoint after repeated failures.

**Fix — make throttler storage resilient:**
```typescript
// In redis.service.ts — wrap the throttler-facing methods
async incr(key: string): Promise<number> {
    try {
        return await this.client.incr(key);
    } catch (err) {
        this.logger.error({ message: 'Redis incr failed', key, err });
        throw err; // Let throttler decide — but catch in throttler storage
    }
}
```

```typescript
// In redis-throttler.storage.ts — catch-all fallback
async increment(key, ttl, limit, blockDuration, _throttlerName) {
    try {
        // ... existing logic ...
    } catch (err) {
        this.logger.error({ message: 'Redis throttler failed, allowing request', err });
        return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
}
```

The throttler storage should fail-open (allow the request) rather than fail-closed (500 every request). Combine with a circuit breaker on the Redis health check to avoid logging floods.

**Also:** Add `@SkipThrottle()` on the webhook controller. Stripe's retry logic is sufficient; rate-limiting webhooks is counterproductive and dangerous.

---

### C-2: Webhook `customer.deleted` Handler Has Dead Write — Local DB Never Updated

| Attribute | Detail |
|-----------|--------|
| **File** | `apps/api/src/webhooks/handlers/customer.handler.ts:44-55` |
| **Root cause** | The handler sets `localCustomer.isDeleted = true` on an in-memory entity but **never calls any repository or service method to persist it**. The comment says "using internal method directly" but the actual method call is missing. |

**Evidence:**
```typescript
case 'customer.deleted':
    try {
        const localCustomer = await this.customersService.findByStripeId(customer.id);
        // Mark as deleted locally
        localCustomer.isDeleted = true;       // ← DEAD WRITE: in-memory only
        // Note: using internal method directly since this is a sync operation
        //                                            ↑ method call is MISSING
        this.logger.log({
            message: 'Customer deleted in Stripe, marking locally',
            stripeCustomerId: customer.id,
        });
    } catch {
        // Customer not in our DB — nothing to do
    }
    break;
```

**Impact:** When a customer is deleted in Stripe (either via Dashboard or API), the local `STRIPE_CUSTOMERS` row remains with `IS_DELETED = 0`. Subsequent queries that filter `IS_DELETED = 0` (which is every query — see `findActiveByEmail`, `findById`, `findByUserId`) will return the deleted customer as if it still exists. The `GET /customers/me` endpoint will return a deleted customer, and the frontend will display it as active.

**Fix:**
```typescript
case 'customer.deleted':
    try {
        const localCustomer = await this.customersService.findByStripeId(customer.id);
        await this.customersService.softDelete(localCustomer.id);  // ← Add this
        this.logger.log({
            message: 'Customer deleted in Stripe, marked locally',
            stripeCustomerId: customer.id,
            localId: localCustomer.id,
        });
    } catch {
        // Customer not in our DB — nothing to do
    }
    break;
```

Note: `softDelete()` calls `this.stripeService.customers.del()` internally, which would be redundant (and possibly fail) since the customer is already deleted in Stripe. Consider a lightweight internal method `softDeleteLocalOnly(id)` that only updates the DB and clears cache, without calling Stripe again.

---

### C-3: Missing FK from STRIPE_SUBSCRIPTIONS.STRIPE_PRICE_ID to SUBSCRIPTION_PLANS

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/database/migrations/005-schema-integrity.ts:28-33`, `apps/api/src/database/schema.sql:131-142`, `apps/api/src/entities/subscription-plan.entity.ts`, `apps/api/src/entities/stripe-subscription.entity.ts` |
| **Root cause** | Migration 005 created `IDX_SUB_PRICE_ID` (an index) with a comment promising a DEFERRABLE FK — but the FK was **never created**. Schema.sql also lacks this constraint. The TypeORM entity has no `@ManyToOne`/`@JoinColumn` to SUBSCRIPTION_PLANS. |

**Evidence — Migration 005:**
```typescript
// ── FK from STRIPE_SUBSCRIPTIONS to SUBSCRIPTION_PLANS ───────────────────
// Using DEFERRABLE so existing data (e.g. external Stripe plans) won't block
await queryRunner.query(`
    CREATE INDEX IDX_SUB_PRICE_ID ON STRIPE_SUBSCRIPTIONS(STRIPE_PRICE_ID)
`);
// ↑ Index created, but NO FK constraint. Comment is misleading — DEFERRABLE was the plan, never executed.
```

**Impact:**
1. A `SUBSCRIPTION_PLAN` row can be deleted while active `STRIPE_SUBSCRIPTIONS` rows reference its `STRIPE_PRICE_ID`.
2. Reporting queries joining `STRIPE_SUBSCRIPTIONS` → `SUBSCRIPTION_PLANS` produce rows with NULL plan data.
3. `syncFromStripeEvent()` in `subscriptions.service.ts` inserts `STRIPE_PRICE_ID` from Stripe event data — if that price ID doesn't exist in `SUBSCRIPTION_PLANS`, there's no DB-level rejection.
4. This is an integrity violation that violates normalization principles and will cause production data issues at scale.

**Fix:**
```sql
-- Add to a new migration
ALTER TABLE STRIPE_SUBSCRIPTIONS
  ADD CONSTRAINT FK_SUB_PRICE_ID
  FOREIGN KEY (STRIPE_PRICE_ID)
  REFERENCES SUBSCRIPTION_PLANS(STRIPE_PRICE_ID)
  ON DELETE RESTRICT;
```

The `ON DELETE RESTRICT` ensures plans with active subscriptions can't be accidentally deleted. If external Stripe plans exist without a `SUBSCRIPTION_PLANS` row, backfill those rows first or use `ON DELETE SET NULL` with a nullable `STRIPE_PRICE_ID` (more complex migration).

---

## HIGH

### H-1: Reporting Endpoint `GET /reports/customers/:customerId/ltv` Lacks Ownership Check

| Attribute | Detail |
|-----------|--------|
| **File** | `apps/api/src/reporting/reporting.controller.ts:31-33` |
| **Root cause** | The endpoint accepts a `customerId` parameter with `ParseUUIDPipe` validation but performs **no authorization check** against the authenticated user. Any authenticated user can query any customer's lifetime value. |

**Evidence:**
```typescript
@Get('customers/:customerId/ltv')
getCustomerLtv(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.reportingService.getCustomerLtv(customerId);  // ← No ownership check
}
```

Compare with the pattern used everywhere else:
```typescript
// customers.controller.ts — correct pattern
async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtUser) {
    return this.assertOwnership(id, user.id);  // ✅
}
```

**Impact:** Authenticated User A can call `GET /reports/customers/<UserB-customer-id>/ltv` and see User B's total revenue, average order value, subscription lifetime, and churn probability. This is a direct horizontal privilege escalation.

**Fix:**
```typescript
@Get('customers/:customerId/ltv')
async getCustomerLtv(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentUser() user: JwtUser,
) {
    const customer = await this.customersService.findById(customerId);
    if (!customer || customer.userId !== user.id) {
        throw new ForbiddenException('Access denied');
    }
    return this.reportingService.getCustomerLtv(customerId);
}
```

Inject `CustomersService` into `ReportingController`.

---

### H-2: Stripe API + DB Write Not Atomic — Cleanup Pattern Is Best-Effort, Not Transactional

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/customers/customers.service.ts:36-66`, `apps/api/src/payment-intents/payment-intents.service.ts:42-97`, `apps/api/src/subscriptions/subscriptions.service.ts:52-84` |
| **Root cause** | Every "create" service method follows the same pattern: (1) call Stripe API, (2) INSERT into local DB, (3) catch DB errors and attempt Stripe cleanup. This is a compensating transaction, not an atomic transaction. If the cleanup itself fails, an orphaned Stripe resource remains. |

**Evidence — `subscriptions.service.ts:52-84`:**
```typescript
const stripeSub = await this.stripeService.subscriptions.create(...);  // Step 1: Stripe (irreversible)

try {
    await this.repo.insert(id, stripeSub.id, ...);                     // Step 2: DB (can fail)
} catch (err) {
    // Step 3: Best-effort cleanup
    this.stripeService.subscriptions.cancel(stripeSub.id).catch((cleanupErr) =>
        this.logger.error({ message: 'Failed to clean up orphaned Stripe subscription', ... })
    );
    throw err;  // Cleanup failure is swallowed — orphan remains
}
```

**Failure modes:**
1. DB insert fails (constraint violation, connection pool exhaustion, deadlock).
2. Cleanup `stripeService.subscriptions.cancel()` also fails (network blip, Stripe API 5xx).
3. The subscription exists in Stripe, is active, and will bill the customer — but the application has no record of it.
4. No alerting, no reconciliation job, no dead-letter queue. The orphan is invisible.

**Why this isn't as bad as it looks:** The idempotency key pattern partially mitigates this — if the same request is retried, `findByIdempotencyKey()` would find nothing (DB insert failed), so it would create a NEW Stripe resource with the same idempotency key, and Stripe would return the *original* resource. Then a new DB insert would succeed. However:
- This only works if the caller retries with the same idempotency key.
- For webhook-initiated syncs (`syncFromStripeEvent`), there's no idempotency key.

**Recommendations (in priority order):**

1. **Short-term:** Add a scheduled reconciliation job that queries Stripe for resources created in the last N hours and cross-references against the local DB. Log/alert on orphans.
2. **Medium-term:** Add a `stripe_resource_cleanup` dead-letter table. When cleanup fails, insert a row with the resource ID, type, and timestamp. A background worker retries cleanup with exponential backoff.
3. **Long-term (ideal):** Reverse the order — INSERT into DB first with status `pending_stripe`, then call Stripe, then UPDATE status to `active`. If Stripe succeeds but the UPDATE fails, the resource is in Stripe but marked `pending_stripe` locally — reconcilable. If Stripe fails, the DB row stays `pending_stripe` and can be garbage-collected.
4. **Pattern already partially correct in `customers.repository.insert()`:** That insert uses `withTransaction()` for the DB write. But the Stripe API call is still outside the transaction scope.

---

### H-3: CSP `unsafe-inline` in `script-src` Undermines XSS Protection

| Attribute | Detail |
|-----------|--------|
| **File** | `apps/web/next.config.mjs:30` |
| **Status** | Acknowledged as "accepted risk" in security report. I'm recategorizing this as HIGH because it's material for PCI compliance. |

**Evidence:**
```javascript
`script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com`,
```

`'unsafe-inline'` disables the primary XSS defense that CSP provides. Any injected `<script>alert(1)</script>` executes. `'unsafe-eval'` in dev mode additionally allows `eval()`.

**PCI DSS 4.0 context:** Requirement 6.4.3 mandates that all payment page scripts are authorized and integrity-checked. Requirement 11.6.1 requires a change-and-tamper detection mechanism. `unsafe-inline` in `script-src` means neither requirement can be met with CSP alone — you'd need a complementary solution (e.g., Stripe's script integrity verification or a third-party script manager).

**Next.js App Router limitation (acknowledged):** The App Router injects inline `<script>` tags for chunk loading and CSS injection. Nonce-based CSP requires `Script` and `Style` components to propagate nonces through React's rendering pipeline, which App Router doesn't fully support.

**Path forward:**
1. **Immediate:** Keep `unsafe-inline` but add a `Trusted Types` header: `require-trusted-types-for 'script'`. This blocks DOM XSS sinks like `innerHTML` and `document.write` even if a script injection succeeds.
2. **Short-term:** Evaluate `next/script` with `nonce` prop. The Pages Router supports this; App Router support is improving.
3. **Medium-term:** Use `strict-dynamic` with a hash-based or nonce-based approach once Next.js App Router nonce support matures.
4. **For Stripe specifically:** Stripe.js is already allowlisted. The concern is any *other* inline script that slips through.

**Debate note:** The security report classified this as MEDIUM/accepted-risk. I'm elevating to HIGH because: (a) this is a Stripe payments app — XSS on a payments page has direct financial consequences, (b) PCI SAQ A+ eligibility may be affected, and (c) the compensating control (Trusted Types) is not yet implemented.

---

### H-4: JWT Access Token Is 15 Minutes — Frontend Has No Proactive Refresh, Leading to Silent Session Loss

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/config/configuration.ts:29`, `apps/api/src/auth/auth.module.ts:20-24`, `apps/web/src/middleware.ts` |
| **Root cause** | The JWT expires in 15 minutes. The frontend middleware only checks for cookie *presence*, not token *validity*. When the token expires mid-session, API calls return 401 but the middleware doesn't redirect until the next full page navigation. The user sees broken UI with no explanation. |

**Evidence — Middleware:**
```typescript
const authToken = request.cookies.get('auth_token')?.value;
// ...
if (!authToken) {
    // Only redirects if cookie is MISSING — not if it's expired
    return NextResponse.redirect(loginUrl);
}
```

The cookie persists for 15 minutes (matching the JWT expiry). The middleware can't validate JWT expiry (no `jose` or `jsonwebtoken` import, and doing so in Edge middleware would be expensive). So the token expires *while the cookie still exists*, and the middleware thinks the user is authenticated.

**What happens:** The `refresh_token` cookie lasts 7 days. If the frontend had a token refresh interceptor, it could silently obtain a new access token. But there's no such interceptor. The `POST /auth/refresh` endpoint exists and works — it's just never called from the frontend.

**Fix:**
1. **Frontend:** Add an RTK Query `baseQuery` wrapper (or axios interceptor) that catches 401 responses, calls `POST /auth/refresh`, retries the original request with the new token, and only redirects to login if the refresh also fails.
2. **Alternatively:** Set access token cookie `maxAge` to 30 minutes (longer than JWT expiry) so the cookie outlives the token, and always attempt refresh before redirecting.
3. **Middleware:** Consider a lightweight JWT expiry check (decode without verify) in middleware to proactively redirect when the token is known-expired, rather than waiting for an API call to fail.

---

## MEDIUM

### M-1: Rate Limiting Is Per-IP, Not Per-User — Shared IPs Share Rate Limits

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/app.module.ts:39-61`, `apps/api/src/redis/redis-throttler.storage.ts` |
| **Root cause** | `@nestjs/throttler` default key generator uses the client IP (`req.ip`). Behind a load balancer, NAT gateway, or corporate proxy, all users share the same source IP and therefore the same rate limit bucket. |

**Evidence:** The `ThrottlerModule.forRootAsync` configuration does not override the default key generator. The throttler storage `increment()` receives a key that is IP-derived.

**Scenarios affected:**
- Office environments where 50 users share one public IP → 100 req/min default ÷ 50 = 2 req/min per actual user.
- Kubernetes cluster with `externalTrafficPolicy: Cluster` → all requests appear to come from the node IP.
- This makes the `auth` throttle (5/min) particularly dangerous — a single shared IP with multiple users will lock everyone out after 5 combined login attempts.

**Fix:**
```typescript
// Custom key generator in app.module.ts
ThrottlerModule.forRootAsync({
    useFactory: (config: ConfigService, storage: RedisThrottlerStorage) => ({
        throttlers: [ /* ... existing ... */ ],
        storage,
        // Override key generation to prefer user ID over IP
        generateKey: (context: ExecutionContext, tracker: string, name: string) => {
            const req = context.switchToHttp().getRequest();
            const userId = req.user?.id;
            if (userId) return `throttle:${name}:${userId}`;  // Per-user
            return `throttle:${name}:${req.ip}`;              // Fallback to IP for unauthenticated
        },
    }),
})
```

This gives each authenticated user their own bucket. Auth endpoints (unauthenticated) would still use IP.

---

### M-2: Refresh Token Issue Silently Fails When Redis Is Unavailable

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/auth/token.service.ts:26-31`, `apps/api/src/redis/redis.service.ts:51-62` |
| **Root cause** | `TokenService.issueTokenPair()` calls `this.redis.set(...)` which has a try/catch that **logs a warning and returns void**. The access token is still generated and returned. But the refresh token (a UUID) is never stored in Redis. |

**Evidence — `token.service.ts:26-31`:**
```typescript
async issueTokenPair(user: TokenPayload): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });
    const refreshToken = randomUUID();
    await this.redis.set(`refresh:${refreshToken}`, { id: user.id, email: user.email }, REFRESH_TTL_SECONDS);
    // ↑ redis.set() catches error internally, logs warning, returns void.
    //   issueTokenPair continues — returns accessToken + refreshToken that will NEVER validate.
    return { accessToken, refreshToken };
}
```

**Impact:** The user receives both tokens and cookies are set. When the access token expires and the client calls `POST /auth/refresh`, `validateRefreshToken()` returns `null` (Redis get returns null), and the user gets a 401 — forced re-login. The failure is silent at issue time and only manifests 15 minutes later.

**Fix:**
```typescript
async issueTokenPair(user: TokenPayload): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });
    const refreshToken = randomUUID();
    try {
        await this.redis.set(`refresh:${refreshToken}`, { id: user.id, email: user.email }, REFRESH_TTL_SECONDS);
    } catch (err) {
        this.logger.error({ message: 'Failed to store refresh token', userId: user.id, err });
        throw new InternalServerErrorException('Unable to complete authentication');
    }
    return { accessToken, refreshToken };
}
```

This requires `RedisService.set()` to re-throw after logging (or provide a version that throws). Currently `set()` swallows errors — make it throw-aware for critical paths.

---

### M-3: Payment Methods Endpoints Lack Tighter Rate Limiting

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/payment-methods/payment-methods.controller.ts` |
| **Root cause** | `listByCustomer`, `setDefault`, and `detach` endpoints have no `@Throttle()` decorator. They fall through to the global default throttle (100 req/min). |

**Comparison:**
| Endpoint | Throttle |
|----------|----------|
| `POST /customers` | `@Throttle({ payment: { limit: 20, ttl: 60_000 } })` ✅ |
| `POST /payment-intents` | `@Throttle({ payment: { limit: 20, ttl: 60_000 } })` ✅ |
| `POST /subscriptions` | `@Throttle({ payment: { limit: 20, ttl: 60_000 } })` ✅ |
| `POST /payment-methods/:id/set-default` | **No throttle** — falls to default 100/min ❌ |
| `DELETE /payment-methods/:id` | **No throttle** — falls to default 100/min ❌ |

`setDefault` and `detach` make Stripe API calls. They should be in the `payment` throttle group.

**Fix:** Add `@Throttle({ payment: { limit: 20, ttl: 60_000 } })` to `setDefault` and `detach`.

---

### M-4: `POST /subscriptions/plans/sync` Has No Authorization Check

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/subscriptions/subscriptions.controller.ts:51-60` |
| **Root cause** | Any authenticated user can clear the plans cache and force a DB re-read. This is a minor DoS vector and cache-poisoning surface. |

**Evidence:**
```typescript
@Post('plans/sync')
@HttpCode(HttpStatus.OK)
async syncPlans() {                               // ← No @CurrentUser(), no role check
    await this.redis.del(CacheKeys.plans(true), CacheKeys.plans(false));
    // ...
}
```

**Fix:** Add a role guard or at minimum check that the user has an admin claim. If role-based access isn't implemented yet, add a `TODO` and document this as an admin endpoint.

---

## LOW

### L-1: CORS Limited to Single Origin — No Staging/Preview Support

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/config/validation.schema.ts:23`, `apps/api/src/config/configuration.ts:32` |
| **Root cause** | `CORS_ORIGIN` accepts a single string validated by Joi. Vercel preview deployments, staging environments, and branch deploys each get a unique URL. Only one can work at a time. |

**Fix:** Accept a comma-separated list or a regex pattern. Joi validation: `Joi.string().pattern(/^https?:\/\/[^,\s]+(,\s*https?:\/\/[^,\s]+)*$/)`. Parse and pass multiple origins to the NestJS CORS config.

---

### L-2: `LOG_FORMAT` Validated but `THROTTLE_TTL` and `THROTTLE_LIMIT` Have No Upper Bounds

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/config/validation.schema.ts:20-21` |
| **Root cause** | `THROTTLE_TTL` and `THROTTLE_LIMIT` accept any number. Setting `THROTTLE_LIMIT=999999999` effectively disables rate limiting. Setting `THROTTLE_TTL=1` creates a 1-second window that's trivially bypassed. |

**Fix:**
```typescript
THROTTLE_TTL: Joi.number().min(1).max(3600).default(60),
THROTTLE_LIMIT: Joi.number().min(1).max(10000).default(100),
```

---

### L-3: Webhook Signature Guard Depends on `rawBody` But No Explicit Verification It's Configured

| Attribute | Detail |
|-----------|--------|
| **Files** | `apps/api/src/common/guards/webhook-signature.guard.ts:33-39`, `apps/api/src/webhooks/webhooks.controller.ts` |
| **Root cause** | `WebhookSignatureGuard` accesses `request.rawBody`. This requires a raw body parser middleware (e.g., `express.raw({ type: 'application/json' })`) configured *before* the JSON body parser, specifically for the webhook route. If this middleware is not present or misconfigured, the guard throws "Raw body not available" on every webhook request. |

**Recommendation:** Add an integration test that sends a raw Buffer body to the webhook endpoint and verifies 200. If this middleware is in `main.ts`, document it explicitly. Consider a NestJS `rawBody` option in the bootstrap.

---

### L-4: `customer.deleted` Webhook Handler Has No Soft-Delete Without Stripe Call (Continued from C-2)

A secondary concern: once C-2 is fixed, using `customersService.softDelete()` will call `this.stripeService.customers.del()` again on the already-deleted Stripe customer. This will throw a Stripe "no such customer" error that the catch block in the handler would swallow. The outcome is correct (local DB updated) but the log will have confusing noise. A dedicated `softDeleteLocal()` method that skips the Stripe call is cleaner.

---

## Attack Surface Analysis

### Privilege Escalation Vectors

| Vector | Status | Mitigation |
|--------|--------|------------|
| Customer-scoped endpoints (customers, payment-methods, subscriptions, payment-intents, setup-intents) | **Mitigated** — all controllers have `assertOwnership()` | Controller-level guard |
| Reporting `customers/:customerId/ltv` | **VULNERABLE** — no ownership check (H-1) | Add ownership check |
| Cache invalidation (`POST /subscriptions/plans/sync`) | **VULNERABLE** — any authenticated user (M-4) | Add role check |
| Webhook endpoints | **Mitigated** — HMAC signature verification | Stripe SDK constructEvent |
| Unauthenticated access to auth endpoints | **Mitigated** — `@Public()` decorator + rate limiting |

### Resilience Failure Modes

| Failure | Impact | Current Mitigation |
|---------|--------|--------------------|
| Redis down | **ALL requests 500** (C-1) — throttler path unprotected | None (C-1) |
| Redis down | Refresh tokens silently fail (M-2) | Partial — access token still works for 15 min |
| Redis down | Cache misses fall back to DB | ✅ try/catch in get/set/del |
| Oracle down | All reads/writes fail | ✅ No mitigation — expected failure |
| Stripe API down | Create operations fail with idempotency | ✅ Idempotency keys + SDK retry |
| BullMQ/Redis down | Webhook events queued in-memory (lost on restart) | ⚠️ BullMQ can use Redis streams; if Redis is down, events are lost |

### Data Leakage Paths

| Path | Status |
|------|--------|
| Error responses include PII | ✅ Fixed — sanitized in AllExceptionsFilter |
| Logs include PII | ✅ Fixed — email scrubbing |
| Customer data via unowned customer ID | ✅ Mitigated in all customer-scoped controllers |
| Customer data via reporting endpoint | ❌ Leaked (H-1) |
| Payment intent via stripe ID lookup | ✅ Mitigated — ownership check on findOne |
| CSP `unsafe-inline` XSS → cookie theft | ⚠️ httpOnly cookies prevent JS access, but XSS can still make authenticated requests |

---

## What Was Fixed Since Prior Reports

| Prior Finding | Status | Verification |
|---------------|--------|-------------|
| P0-1: Redis failures crash endpoints (get/set) | ✅ **Fixed** | `redis.service.ts:30-44` — try/catch in get() |
| P0-1: Redis set() error handling | ✅ **Fixed** | `redis.service.ts:46-62` — try/catch in set() |
| P0-2: NEXT_PUBLIC_DEMO_CUSTOMER_ID hardcoded | ⚠️ **Not verified** | Need to check frontend code |
| P0-3: No refresh tokens | ✅ **Fixed** | `token.service.ts` — full refresh + rotation |
| P1-1: No DB transaction | ⚠️ **Partial** | `withTransaction()` helper used in customer.insert but not elsewhere |
| P1-2: No user→customer ownership | ✅ **Fixed** | `assertOwnership()` in all controllers |
| P1-3: Missing FK STRIPE_SUBSCRIPTIONS → SUBSCRIPTION_PLANS | ❌ **NOT FIXED** | Only index created, no FK (C-3) |
| P1-4: In-memory throttler | ✅ **Fixed** | `RedisThrottlerStorage` with Redis backend |
| P1-5: findByStripeId incomplete cache | ✅ **Fixed** | Now calls `findById(row.id)` for full object |
| P1-6: Reporting endpoints unprotected | ⚠️ **Partial** | Class-level throttle added, but LTV endpoint has no ownership (H-1) |
| P2-1: LOG_FORMAT not validated | ✅ **Fixed** | `validation.schema.ts` validates LOG_FORMAT |
| P2-2: Email index, not constraint | ✅ **Fixed** | Migration 005: `UQ_CUSTOMER_EMAIL` |
| P2-3: CSP unsafe-inline | ❌ **NOT FIXED** | Acknowledged limitation (H-3) |
| P2-4: No DB check constraints | ✅ **Fixed** | Migrations 005: CHK_PI_STATUS, CHK_SUB_STATUS, CHK_WH_STATUS |
| P2-5: Plan cache no invalidation | ✅ **Fixed** | `POST /subscriptions/plans/sync` endpoint added |

---

## Remediation Roadmap

### Immediate (This Sprint — Before Production Traffic)

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **P0** | C-1 | Wrap throttler storage methods in try/catch with fail-open fallback; add `@SkipThrottle()` to webhook controller | 1 hour |
| **P0** | C-2 | Add `softDelete` call in customer.deleted webhook handler | 15 min |
| **P0** | H-1 | Add ownership check to `GET /reports/customers/:customerId/ltv` | 30 min |

### Short-Term (Next Sprint)

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **P1** | C-3 | Create and run migration adding FK_SUB_PRICE_ID | 1 hour (plus backfill if needed) |
| **P1** | H-4 | Add RTK Query refresh interceptor on frontend | 3 hours |
| **P1** | M-1 | Implement per-user rate limit key generation | 2 hours |
| **P1** | M-2 | Make token refresh storage throw on failure | 30 min |
| **P1** | M-3 | Add payment throttle to setDefault/detach endpoints | 15 min |

### Medium-Term (2-3 Sprints)

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **P2** | H-2 | Add reconciliation job for orphaned Stripe resources | 4 hours |
| **P2** | H-3 | Add Trusted Types header; evaluate nonce-based CSP | 4 hours |
| **P2** | M-4 | Add role-based guard for admin endpoints | 3 hours |
| **P2** | L-1 | Support multiple CORS origins | 1 hour |
| **P2** | L-2 | Add bounds to throttle config validation | 15 min |
| **P2** | L-3 | Add webhook raw body integration test | 2 hours |

---

## Debated / Controversial Findings

### 1. Is C-1 truly critical? "Redis is reliable" argument.

**Counter-argument:** Redis is a single point of failure that the codebase already treats as non-critical (cache). The application gracefully degrades when Redis is down for caching. But the throttler path was overlooked — it's a *control plane* dependency, not a data plane cache. The throttler MUST work for the application to function. Combining the throttler and cache into the same Redis instance creates a coupling that violates the principle of least dependency.

**Recommendation:** In production, run a separate Redis instance (or Redis cluster) for the throttler. If the cache Redis goes down, the app works (slower). If the throttler Redis goes down, the app must fail-open or use a local fallback counter.

### 2. Is the cleanup pattern (H-2) acceptable given idempotency?

**My position:** The idempotency key pattern provides a *recovery path* for API-initiated creates, but it's not a substitute for atomicity. The cleanup pattern is vulnerable to:
- Webhook-initiated creates that don't use idempotency keys
- Partial failures where the Stripe resource was only partially created
- Cleanup failures that go unnoticed (no dead-letter queue)

**The CODE_QUALITY_REPORT P1-1 finding is still valid** — only `customers.repository.insert()` uses `withTransaction()`. Payment intents and subscriptions have the same pattern but no transaction wrapping.

### 3. Is CSP `unsafe-inline` really HIGH severity?

**My position:** Yes, for a payments application. While httpOnly cookies prevent token theft, XSS on a payment page can:
- Modify payment amounts in the DOM before the user confirms
- Redirect to a lookalike Stripe checkout
- Capture card details entered into a payment element (DOM clobbering)
- Make authenticated API calls (CSRF via fetch with credentials: 'include')

The accepted risk from the security report is reasonable for an MVP/internal tool. For a production payments app handling real money, the bar is higher.

### 4. Should the webhook endpoint be rate-limited?

**My position:** No. Stripe's webhook delivery system has its own rate limiting and retry logic. Adding application-level rate limiting to webhooks is:
- Redundant: Stripe already throttles at their end
- Dangerous: A burst of legitimate events (e.g., invoice.payment_succeeded for 1000 subscriptions at billing cycle start) would be throttled
- Violates Stripe best practices: Stripe recommends returning 200 as fast as possible and processing async

**The webhook endpoint should explicitly bypass the throttler.** Currently it doesn't — it's covered by the global `ThrottlerGuard`.

---

## Appendix: File Reference Index

| File | Key Findings |
|------|-------------|
| `apps/api/src/redis/redis.service.ts` | C-1: incr/ttl/expire/setWithExpiry lack try/catch |
| `apps/api/src/redis/redis-throttler.storage.ts` | C-1: No failure fallback |
| `apps/api/src/webhooks/handlers/customer.handler.ts` | C-2: Dead write on customer.deleted |
| `apps/api/src/database/migrations/005-schema-integrity.ts` | C-3: FK_SUB_PRICE_ID never created |
| `apps/api/src/database/schema.sql` | C-3: No FK on STRIPE_SUBSCRIPTIONS.STRIPE_PRICE_ID |
| `apps/api/src/reporting/reporting.controller.ts` | H-1: Missing ownership check on LTV endpoint |
| `apps/api/src/customers/customers.service.ts` | H-2: Cleanup pattern, not atomic |
| `apps/api/src/subscriptions/subscriptions.service.ts` | H-2: Cleanup pattern, not atomic |
| `apps/api/src/payment-intents/payment-intents.service.ts` | H-2: Cleanup pattern, not atomic |
| `apps/web/next.config.mjs` | H-3: unsafe-inline in script-src |
| `apps/api/src/config/configuration.ts` | H-4: 15-min JWT expiry |
| `apps/web/src/middleware.ts` | H-4: No proactive token refresh |
| `apps/api/src/app.module.ts` | M-1: IP-based key generation; webhook not skip-throttled |
| `apps/api/src/auth/token.service.ts` | M-2: Silent refresh token storage failure |
| `apps/api/src/payment-methods/payment-methods.controller.ts` | M-3: Missing payment throttle |
| `apps/api/src/subscriptions/subscriptions.controller.ts` | M-4: Cache invalidation without auth |
| `apps/api/src/config/validation.schema.ts` | L-2: No bounds on throttle config; L-1: single CORS origin |
