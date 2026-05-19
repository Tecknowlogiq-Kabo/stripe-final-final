# Implementation Plan — 10-Day Critical Path

Based on [FINAL-VERDICT.md](./FINAL-VERDICT.md). Following the exact Critical Path in order.

---

## Phase 1: Stop the Bleeding (Days 1-2)

### Fix 1: Wrap throttler storage in try/catch with fail-open
**File:** `apps/api/src/redis/redis.service.ts` (lines ~82-100)
**Effort:** 30 min
- Wrap `incr()`, `ttl()`, `expire()`, `setWithExpiry()` in try/catch
- Fail-open: `incr` → return 0, `ttl` → return -2, `expire`/`setWithExpiry` → silently skip

### Fix 2: Add `@SkipThrottle()` to webhook controller + fix lying comment
**File:** `apps/api/src/webhooks/webhooks.controller.ts`
**Effort:** 5 min
- Import `SkipThrottle` from `@nestjs/throttler`
- Add class-level `@SkipThrottle()` decorator
- Delete the misleading comment about "ThrottlerGuard is bypassed"
- Replace with accurate comment

### Fix 3: Fix `customer.deleted` dead write
**File:** `apps/api/src/webhooks/handlers/customer.handler.ts` (lines ~44-55)
**Effort:** 15 min
- Replace `localCustomer.isDeleted = true` with `await this.customersService.repo.softDelete(localCustomer.id)`
- Fix the comment ("using internal method directly since this is a sync operation")

### Fix 4: Add try/catch + Stripe cleanup to PaymentIntentsService.create()
**File:** `apps/api/src/payment-intents/payment-intents.service.ts` (lines ~24-115)
**Effort:** 45 min
- Move success log from BEFORE `repo.insert()` to AFTER
- Wrap Stripe API + DB insert in try/catch
- On DB insert failure, cancel the Stripe PaymentIntent via `stripeService.paymentIntents.cancel()`
- Match the pattern in CustomersService/SubscriptionsService

### Fix 5: Add try/catch + Stripe cleanup to SetupIntentsService.create()
**File:** `apps/api/src/setup-intents/setup-intents.service.ts` (lines ~20-80)
**Effort:** 45 min
- Wrap Stripe API + DB insert in try/catch
- On DB insert failure, cancel the Stripe SetupIntent via `stripeService.setupIntents.cancel()`

### Fix 6: Move PaymentIntentsService.create() success log AFTER repo.insert()
**File:** `apps/api/src/payment-intents/payment-intents.service.ts`
**Effort:** 5 min
- Move the `this.logger.log()` call from before `repo.insert()` to after it

### Fix 7: Add `withTransaction()` to PaymentIntentsRepository.insert()
**File:** `apps/api/src/payment-intents/payment-intents.repository.ts`
**Effort:** 15 min
- Import `withTransaction` from `../database/transaction.helper`
- Wrap INSERT + SELECT in `withTransaction()`
- Match the pattern in CustomersRepository.insert()

### Fix 8: Add `withTransaction()` to SetupIntentsRepository.insert()
**File:** `apps/api/src/setup-intents/setup-intents.repository.ts`
**Effort:** 15 min
- Import `withTransaction` from `../database/transaction.helper`
- Wrap INSERT + SELECT in `withTransaction()`

### Fix 9: Replace `process.exit(1)` with graceful shutdown
**File:** `apps/api/src/main.ts` (lines ~15-18)
**Effort:** 15 min
- Replace `process.exit(1)` in `unhandledRejection` handler with graceful `app.close()` then exit
- Need to restructure: store `app` reference at module level so the handler can access it

### Fix 10: Fix error/loading page color scheme
**Files:** `apps/web/src/app/error.tsx`, `apps/web/src/app/loading.tsx`, `apps/web/src/app/checkout/error.tsx`, `apps/web/src/app/subscriptions/error.tsx`, `apps/web/src/app/payment-methods/error.tsx`
**Effort:** 10 min
- Swap `text-gray-900` → `text-zinc-100` 
- Swap `text-gray-500` → `text-zinc-400`
- For dark theme consistency in payment pages

---

## Phase 2: Lock Down the Perimeter (Days 3-5)

### Fix 11: Add ownership check to GET /reports/customers/:customerId/ltv
**File:** `apps/api/src/reporting/reporting.controller.ts`
**Effort:** 30 min

### Fix 12: Add `role` column to APP_USERS + RolesGuard
**Files:** `apps/api/src/auth/entities/user.entity.ts`, migration, `apps/api/src/auth/guards/roles.guard.ts`
**Effort:** 2 hours

### Fix 13: Restrict ALL aggregate reporting endpoints to admin role
**File:** `apps/api/src/reporting/reporting.controller.ts`
**Effort:** 30 min

### Fix 14: Add Prometheus metrics endpoint
**Files:** New `apps/api/src/metrics/` module
**Effort:** 3 hours

### Fix 15: Add Sentry error tracking
**Files:** `apps/api/src/main.ts`, `apps/api/src/instrumentation.ts`
**Effort:** 2 hours

### Fix 16: Add Grafana dashboard + alerting config
**Files:** New config files
**Effort:** 2 hours

### Fix 17: Make TokenService.issueTokenPair() throw on Redis failure
**File:** `apps/api/src/auth/token.service.ts`
**Effort:** 10 min

### Fix 18: Add @Throttle to PaymentMethods setDefault/detach
**File:** `apps/api/src/payment-methods/payment-methods.controller.ts`
**Effort:** 5 min

---

## Phase 3: Harden and Validate (Days 6-8)

### Fix 19: Add FK_SUB_PRICE_ID constraint
**File:** New migration
**Effort:** 1 hour

### Fix 20: Add per-user rate limit key generation
**File:** `apps/api/src/app.module.ts`
**Effort:** 1.5 hours

### Fix 21: Add Trusted Types header to Next.js CSP
**File:** `apps/web/next.config.mjs`
**Effort:** 5 min

### Fix 22: Add Redis AOF persistence + volume
**File:** `docker-compose.yml`
**Effort:** 30 min

### Fix 23: Fix invoice.created / invoice.finalized silent no-ops
**Files:** `apps/api/src/webhooks/handlers/invoice.handler.ts`, `apps/api/src/webhooks/webhooks.service.ts`
**Effort:** 30 min

### Fix 24: Add @Throttle to POST /auth/refresh
**File:** `apps/api/src/auth/auth.controller.ts`
**Effort:** 5 min

### Fix 25: Fix clearCookie() in logout
**File:** `apps/api/src/auth/auth.controller.ts`
**Effort:** 5 min

### Fix 26: Add webhook replay protection
**File:** `apps/api/src/common/guards/webhook-signature.guard.ts`
**Effort:** 30 min

### Fix 27: Delete shared-types dead package
**File:** `packages/shared-types/`
**Effort:** 15 min

---

## Phase 4: Pre-Launch Verification (Days 9-10)

- Integration test: customer.deleted webhook → DB IS_DELETED = 1
- Integration test: Redis outage → throttler fail-open
- Integration test: Stripe API success + DB insert failure → cleanup succeeds
- E2E test: Register → Add PM → Subscribe → Cancel
- Stripe webhook test mode: Send all 26 event types
- Load test: 100 concurrent checkouts
- Production Docker Compose override

---

## Verification

After Phase 1:
```bash
cd apps/api && npx tsc --noEmit  # TypeScript compiles
npm test                           # All tests pass
```

After Phase 2:
```bash
docker-compose up -d               # Services start
curl http://localhost:3001/api/v1/health  # Health check
curl http://localhost:3001/api/v1/metrics # Metrics endpoint
```

After Phase 3:
```bash
# Run full test suite
npm test
# Test webhook replay protection
# Test rate limiting with Redis down
```
