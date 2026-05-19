# Error Handling Stress Test — Audit Report

**Date:** 2026-05-19  
**Scope:** `apps/api/src/` — full source tree  
**Method:** Read every controller, service, filter, guard, middleware, interceptor, DTO, and repository. Traced each scenario through the exact code path, including NestJS lifecycle (Middleware → Guard → Interceptor → Pipe → Controller → Service → Repository).

---

## Architecture Overview

```
Request Flow:
  CorrelationIdMiddleware → RequestTimeoutMiddleware → ...
  → PerUserThrottlerGuard → JwtAuthGuard → RolesGuard
  → MetricsInterceptor → AuditInterceptor → ValidationPipe
  → Controller → Service → Stripe SDK / Oracle / Redis / BullMQ
  → StripeExceptionFilter  (for Stripe.errors.StripeError)
  → AllExceptionsFilter    (fallback — catches everything else)
```

**Key components:**

| Component | File | Role |
|---|---|---|
| `StripeExceptionFilter` | `common/filters/stripe-exception.filter.ts` | Catches Stripe SDK errors, maps to HTTP |
| `AllExceptionsFilter` | `common/filters/all-exceptions.filter.ts` | Catch-all for unhandled errors |
| `RequestTimeoutMiddleware` | `common/middleware/request-timeout.middleware.ts` | 30s timeout (excludes webhooks) |
| `CorrelationIdMiddleware` | `common/middleware/correlation-id.middleware.ts` | Sets `x-correlation-id` on req + res |
| `WebhookSignatureGuard` | `common/guards/webhook-signature.guard.ts` | Verifies Stripe webhook signatures |
| `StripeService` | `stripe/stripe.service.ts` | Stripe SDK wrapper (maxNetworkRetries: 2) |
| `RedisService` | `redis/redis.service.ts` | ioredis wrapper, fail-open on all errors |
| `RedisThrottlerStorage` | `redis/redis-throttler.storage.ts` | Rate limit state in Redis |
| `withTransaction()` | `database/transaction.helper.ts` | BEGIN/COMMIT/ROLLBACK wrapper |
| `WebhookProcessor` | `webhooks/webhook.processor.ts` | BullMQ worker, DLQ on exhaustion |

---

## Scenario-by-Scenario Analysis

### 1. Stripe API timeout (>30s) during payment-intent creation

**Code path:**
```
POST /payment-intents
  → CorrelationIdMiddleware (sets correlationId)
  → RequestTimeoutMiddleware (starts 30s timer)
  → PerUserThrottlerGuard
  → JwtAuthGuard
  → PaymentIntentsController.create()
    → PaymentIntentsService.create()
      → stripeService.paymentIntents.create()
        → Stripe SDK (retries 2x via maxNetworkRetries: 2)
        → throws Stripe.errors.StripeConnectionError after all retries
      → catch block: logs error, re-throws
    → (uncaught in controller)
  → StripeExceptionFilter catches StripeConnectionError
    → status: 503 SERVICE_UNAVAILABLE
    → message: "Payment service temporarily unavailable. Please retry."
    → responseBody: { statusCode, message, stripeRequestId, retryAfter: 5, timestamp, path }
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ⚠️ PARTIAL | `StripeExceptionFilter` handles it, BUT `RequestTimeoutMiddleware` fires first at 30s |
| Status code | ⚠️ RACE | Middleware sends `503` at 30s; filter would also try to send response → `ERR_HTTP_HEADERS_SENT` |
| correlationId in response? | ❌ BUG | `RequestTimeoutMiddleware` response body does NOT include `correlationId` |
| stripeRequestId in response? | ✅ | `StripeExceptionFilter` includes `stripeRequestId` |
| Logged appropriately? | ✅ | `StripeExceptionFilter` logs at `error` level with full context |
| `stripeRequestId` in response? | ⚠️ RACE | If middleware wins, no `stripeRequestId` — Stripe support correlation lost |

**Critical issue:** When Stripe takes >30s, `RequestTimeoutMiddleware` fires first (sends 503), then the Stripe error re-throws through `StripeExceptionFilter` which tries to send again → crashes with `ERR_HTTP_HEADERS_SENT` or silently fails. The middleware response also **omits `correlationId`**, breaking traceability.

**Severity: HIGH** — Double-response potential + missing correlation ID on timeout.

---

### 2. Stripe returns 402 card_declined

**Code path:**
```
POST /payment-intents
  → PaymentIntentsService.create()
    → stripeService.paymentIntents.create() → Stripe SDK
    → throws Stripe.errors.StripeCardError
    → catch block: logs error, re-throws
  → StripeExceptionFilter catches StripeCardError
    → status: 402 PAYMENT_REQUIRED
    → message: "Payment declined: {decline_code with underscores replaced by spaces}"
    → responseBody: { statusCode, message, stripeRequestId, timestamp, path }
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ✅ | `StripeExceptionFilter` catches `StripeCardError` |
| Status code | ✅ | 402 `PAYMENT_REQUIRED` |
| decline_code in response? | ✅ | Exposed in `message` field: `"Payment declined: card declined"` |
| correlationId in response? | ❌ BUG | **NOT included** in `StripeExceptionFilter` response body |
| stripeRequestId in response? | ✅ | Included |
| Logged appropriately? | ✅ | Logged at `error` level with `stripeRequestId`, `stripeErrorType`, `stripeErrorCode`, `declineCode`, `correlationId` |

**Issue:** `StripeExceptionFilter` response body omits `correlationId`. `AllExceptionsFilter` includes it, but `StripeExceptionFilter` does not. Clients must rely on the `x-correlation-id` response header set by `CorrelationIdMiddleware`.

**Severity: MEDIUM** — Information missing from response body but available via header.

---

### 3. Stripe returns 429 rate limit — Retry-After propagation

**Code path:**
```
→ StripeExceptionFilter catches Stripe.errors.StripeRateLimitError
  → status: 429 TOO_MANY_REQUESTS
  → shouldRetry: true
  → responseBody.retryAfter = 5  (HARDCODED!)
  → JSON body: { statusCode: 429, message: "Too many requests...", retryAfter: 5, stripeRequestId, ... }
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ✅ | `StripeRateLimitError` handled |
| Status code | ✅ | 429 |
| Retry-After header? | ❌ BUG | `retryAfter: 5` is in JSON **body**, NOT as HTTP `Retry-After` header |
| Retry-After value correct? | ❌ BUG | Hardcoded to `5` seconds. Stripe's actual `Retry-After` value from the Stripe response is **lost** |
| correlationId in response? | ❌ BUG | Not included |
| stripeRequestId in response? | ✅ | Included |

**Critical issues:**
1. `Retry-After` is a body field, not an HTTP header. Standard HTTP clients, load balancers, and proxies look for the `Retry-After` response header, not a JSON body field. The `retryAfter` in the JSON body is non-standard and will be ignored by infrastructure.
2. The value is hardcoded to `5`, ignoring Stripe's actual retry-after duration from the 429 response. Stripe may indicate a longer wait period.

**Severity: HIGH** — Missing standard `Retry-After` header breaks rate-limit propagation to infrastructure.

---

### 4. Oracle connection pool exhausted (all 10 connections busy)

**Code path (e.g., during payment-intent creation):**
```
PaymentIntentsService.create()
  → repo.insert() → withTransaction()
    → dataSource.createQueryRunner().connect()
    → Oracle pool exhausted → poolTimeout: 30s → throws Error
  → catch block: logs dbError, cancels Stripe PI, throws InternalServerErrorException
  → AllExceptionsFilter catches HttpException(500)
    → responseBody: { statusCode: 500, message: "Failed to save payment intent...", correlationId, timestamp, path }
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ✅ | `PaymentIntentsService` catch block catches DB error, cleans up Stripe PI, throws `InternalServerErrorException` |
| Status code | ✅ | 500 |
| Orphan Stripe resource? | ✅ | Service cancels the Stripe PI in the catch block before re-throwing |
| Retryable for client? | ✅ | Message says "Please try again" |
| correlationId in response? | ✅ | `AllExceptionsFilter` includes it |
| Logged appropriately? | ✅ | `error` level with `stripePaymentIntentId`, `dbError` message |

**Note:** The Oracle connection pool is configured with `poolMax: 20`, `poolMin: 5`, `poolTimeout: 30`. Pool exhaustion means ALL subsequent requests will also fail with 500 until connections free up. This is a degraded-state scenario. The TypeORM `poolTimeout` doesn't throw a distinguishable error type — it'll be a generic `Error` that gets caught by the service's catch block or `AllExceptionsFilter`.

**Severity: MEDIUM** — Handled correctly per-request, but no circuit-breaker or health-check integration to detect systemic pool exhaustion.

---

### 5. Oracle deadlock (ORA-00060) during concurrent subscription creation

**Code path:**
```
SubscriptionsService.create()
  → repo.findActiveByCustomerAndPrice()  ← SELECT (outside transaction)
  → stripeService.subscriptions.create() → Stripe API
  → repo.insert() → withTransaction()
    → BEGIN → INSERT → COMMIT
    → ORA-00060 deadlock detected
    → ROLLBACK → re-throw error
  → catch block: stripeService.subscriptions.cancel() (fire-and-forget)
  → re-throw err
  → AllExceptionsFilter → 500
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ✅ | `withTransaction()` rolls back and re-throws |
| Transaction rolled back? | ✅ | `withTransaction()` catches → `rollbackTransaction()` → re-throws |
| Orphan Stripe subscription cleaned? | ✅ | Service cancels Stripe subscription in catch block (with `.catch()` for cleanup errors) |
| Status code | ✅ | 500 (via `AllExceptionsFilter`) |
| correlationId in response? | ✅ | Yes |
| Concurrency control for check-then-act? | ❌ GAP | The `findActiveByCustomerAndPrice()` check is outside the transaction. Two concurrent requests can both pass the check, both create Stripe subscriptions, causing one INSERT to deadlock. |

**Race window:** Two concurrent `POST /subscriptions` with same `customerId` + `priceId`:
1. Both pass `findActiveByCustomerAndPrice()` → both find no existing subscription
2. Both create separate Stripe subscriptions via API
3. One INSERT succeeds, the other gets ORA-00060 (if unique constraint exists) or duplicate row
4. Deadlocked request cancels its Stripe subscription via API — cleanup works

**Severity: MEDIUM** — Deadlock handled gracefully with orphan cleanup, but the SELECT-before-INSERT race is preventable with a unique constraint or `INSERT ... WHERE NOT EXISTS`.

---

### 6. Redis sentinel failover — connection drops mid-request

**Code path for Redis operations:**
```
RedisService.get/set/del/incr/ttl/expire/setWithExpiry()
  → ioredis client operation
  → if error: try/catch → log error, return safe fallback
```

**Failure modes by use case:**

| Use Case | Redis Method | Fallback Behavior |
|---|---|---|
| Rate limiting | `incr()`, `ttl()`, `expire()` | Fail-open: returns 0 / -2 → requests allowed through |
| Cache (plans) | `get()`, `set()` | Cache miss → falls back to DB query |
| Cache (customers) | `get()`, `set()` | Cache miss → falls back to DB query |
| Throttler storage | `RedisThrottlerStorage.increment()` | Fail-open via underlying `incr`/`ttl` |

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ✅ | All RedisService methods have try/catch |
| Fail-open design? | ✅ | Rate limiting allows requests through; caching falls back to DB |
| Retry strategy? | ⚠️ GAP | No explicit `retryStrategy` on ioredis constructor — uses ioredis defaults |
| Sentinel support? | ❌ NOT CONFIGURED | ioredis created with `new Redis(url)` — no sentinel configuration |

**Issue:** The ioredis client is created with a plain URL: `new Redis(config.get('redis.url'))`. For Redis Sentinel, ioredis requires explicit sentinel configuration (`sentinels: [...]`, `name: 'mymaster'`). During a sentinel failover, the application would see connection errors until ioredis reconnects to the new master. The fail-open design means the application stays available (rate limits disabled, cache misses on DB), but there will be a transient error spike during the failover window.

**Severity: MEDIUM** — Fail-open design is correct, but Redis sentinel is not supported by the current ioredis configuration.

---

### 7. BullMQ queue backpressure — 10,000 webhook events simultaneously

**Code path:**
```
POST /webhooks/stripe  (× 10,000 concurrent)
  → WebhookSignatureGuard (signature verification)
  → WebhooksController.handleStripeWebhook()
    → WebhooksService.processEvent()
      → Check existing event (SELECT)
      → Encrypt payload, INSERT/UPDATE into STRIPE_WEBHOOK_EVENTS
      → webhookQueue.add() → returns immediately
    → Returns 200 { received: true }
  → Stripe receives 200 OK
```

**Queue processing (async):**
```
WebhookProcessor.process()  (BullMQ worker, concurrency default: 1)
  → WebhooksService.execute()
    → Decrypt payload, dispatch to handler
    → On success: mark as 'processed'
    → On failure: mark as 'failed', BullMQ retries 3× with exponential backoff
    → After 3 failures: move to DLQ
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Stripe gets 200 quickly? | ✅ | `processEvent()` returns after DB insert + queue add |
| Queue backpressure handled? | ✅ | BullMQ naturally handles backpressure |
| Data loss on failure? | ✅ | DLQ after 3 retries, kept forever for manual review |
| Events persisted before queue? | ✅ | Encrypted event stored in Oracle before BullMQ enqueue |
| DB connection pool bottleneck? | ⚠️ RISK | 10,000 concurrent webhook POSTs → up to 20 Oracle connections (poolMax). Each `processEvent()` needs 1-2 queries. Requests queue up to 30s (poolTimeout), then fail with 500. Stripe retries failed webhooks. |

**Issue:** Under extreme load (10,000 concurrent webhooks), the Oracle connection pool (max 20) is the bottleneck. Requests beyond pool capacity wait up to `poolTimeout` (30s) then fail. Stripe retries these, which can create a retry storm. No rate limiting on the webhook endpoint (`@SkipThrottle()` is applied).

**Severity: LOW** — Queue design is solid. The DB bottleneck is mitigated by Stripe's retry mechanism. Consider increasing `poolMax` or adding a concurrency limit on the webhook endpoint.

---

### 8. Invalid JSON in Stripe webhook body (before signature verification)

**Code path:**
```
POST /webhooks/stripe  (invalid JSON body)
  → NestJS rawBody parser captures req.rawBody (Buffer)
  → express.json() → SyntaxError: Unexpected token...
  → type: 'entity.parse.failed'
  → AllExceptionsFilter catches it
    → status: 400 (from exception)
    → message: exception message ("Unexpected token ...")
  → responseBody: { statusCode: 400, message: "Unexpected token...", correlationId, timestamp, path }
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Error caught? | ✅ | `AllExceptionsFilter` specifically checks for `entity.parse.failed` |
| Status code | ⚠️ PARTIAL | 400 from the exception, but could also be 413 if body-parser throws that |
| Internal details leaked? | ⚠️ MINOR | The JSON parse error message (e.g., "Unexpected token X in JSON at position 42") is passed through to the client. This is a standard Express behavior, not sensitive. |
| Signature verified? | N/A | `WebhookSignatureGuard` never runs — error occurs before guard |
| correlationId in response? | ✅ | Yes (set by `CorrelationIdMiddleware` which runs before body parser) |
| rawBody preserved? | ✅ | `rawBody: true` captures it at NestJS level before Express parsing |

**Severity: LOW** — Correctly handled. Minor concern: parse error message includes position info, which is standard and not sensitive.

---

### 9. Invalid amounts: negative, 0, or exceeding Stripe's max

**Code path:**
```
POST /payment-intents
  → ValidationPipe
    → CreatePaymentIntentDto validation
    → @Min(50) fails → ValidationPipe throws BadRequestException
    → @Max(99999999) fails → ValidationPipe throws BadRequestException
  → AllExceptionsFilter catches HttpException(400)
  → responseBody: { statusCode: 400, message: ["amount must not be less than 50", ...], correlationId, timestamp, path }
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Negative/0 rejected? | ✅ | `@Min(50)` — Stripe minimum is 50 cents |
| >$999,999.99 rejected? | ✅ | `@Max(99999999)` — ~$999,999.99 |
| Status code | ✅ | 400 |
| Validation details in response? | ✅ | Field-level error messages |
| Stripe API called? | ✅ NO | Rejected at validation layer |
| correlationId in response? | ✅ | Yes |

**Note:** Stripe's actual maximum for a single PaymentIntent varies by currency (e.g., $999,999.99 for USD). The `@Max(99999999)` (representing cents) correctly matches this. For currencies like JPY (no decimal), the limit would differ, but the validation uses the same cent-based value. Stripe would reject amounts exceeding its per-currency limit with `StripeInvalidRequestError`.

**Severity: NONE** — Correctly handled at validation layer.

---

### 10. Unsupported currency (e.g., 'XYZ')

**Code path:**
```
POST /payment-intents  { currency: "XYZ" }
  → ValidationPipe → CreatePaymentIntentDto
    → @Matches(/^[A-Za-z]{3}$/) → PASSES (format check only, not validity)
  → PaymentIntentsService.create()
    → stripeService.paymentIntents.create({ currency: "xyz", ... })
    → Stripe API rejects → throws Stripe.errors.StripeInvalidRequestError
  → catch block: logs error, re-throws
  → StripeExceptionFilter catches StripeInvalidRequestError
    → status: 400
    → message: "Invalid payment request. Please check your input."
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Format validated? | ✅ | Regex checks 3-letter alphabetic code |
| Currency validity? | ⚠️ DEFERRED | Deferred to Stripe — no application-level currency allowlist |
| Error caught? | ✅ | `StripeExceptionFilter` maps to 400 |
| User message useful? | ⚠️ VAGUE | "Invalid payment request" — doesn't tell user the currency field is the problem |
| Stripe error details? | ✅ | Logged (but not exposed to client) |
| correlationId in response? | ❌ BUG | `StripeExceptionFilter` omits `correlationId` |

**Severity: LOW** — Functional, but user message is unhelpful for debugging. Consider adding a currency allowlist in the DTO.

---

### 11. Detached payment method race condition

**Code path:**
```
POST /payment-intents  { paymentMethodId: "pm_detached" }
  → PaymentIntentsService.create()
    → stripeService.paymentIntents.create({ payment_method: "pm_detached" })
    → Stripe API rejects → Stripe.errors.StripeInvalidRequestError
    → StripeExceptionFilter → 400 "Invalid payment request"
```

**Race scenario:**
```
Timeline:
  T1: Client A creates PaymentIntent with pm_123 (currently attached)
  T2: Client B detaches pm_123
  T3: Stripe processes A's payment intent

If T3 < T2: Payment succeeds (correct)
If T3 > T2: Stripe rejects with "No such payment method" (correct)
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Application-level check? | N/A | No — defers entirely to Stripe |
| Race handled correctly? | ✅ | Stripe is the source of truth for payment method attachment state |
| Error propagated? | ✅ | StripeInvalidRequestError → 400 |
| Orphan payment intent? | ❌ POTENTIAL | If the Stripe create succeeds but payment method is later detached before confirmation, the PI is still valid. This is normal Stripe behavior (PI can exist without a payment method). |

**Severity: NONE** — Correctly defers to Stripe as the authoritative source.

---

### 12. Subscription cancellation while payment is processing

**Code path A — Cancel:**
```
DELETE /subscriptions/:id
  → SubscriptionsController.cancel()
    → SubscriptionsService.cancel()
      → this.findById(id)  ← DB read
      → stripeService.subscriptions.cancel(stripeSubId)  ← Stripe API
      → repo.updateCancel(id, status, cancelAtPeriodEnd)  ← DB write
```

**Code path B — Webhook (payment succeeded):**
```
WebhookProcessor → WebhooksService.execute()
  → SubscriptionHandler.handle('customer.subscription.updated')
    → SubscriptionsService.syncFromStripeEvent(stripeSub)
      → repo.findByStripeId(stripeSub.id)
      → repo.syncUpdate(id, status, periodStart, periodEnd, ...)
```

**Concurrent execution:**
```
T1: Cancel reads sub from DB (status: 'active')
T2: Webhook arrives — payment_intent.succeeded for latest invoice
T3: syncFromStripeEvent updates DB (status: 'active', new period dates)
T4: stripe.subscriptions.cancel() completes — Stripe returns status: 'canceled'
T5: repo.updateCancel writes status: 'canceled'
T6: Final DB state: 'canceled' — webhook update from T3 is overwritten
```

**FINDINGS:**

| Check | Status | Detail |
|---|---|---|
| Concurrency control? | ❌ NONE | No optimistic locking, no version column, no SELECT FOR UPDATE |
| Eventual consistency? | ⚠️ RISK | Last write wins. If the webhook reflects a state that Stripe considers authoritative, the cancel's DB update may overwrite it |
| Data integrity? | ⚠️ RISK | If cancel_at_period_end is set, the subscription should remain active until period end. The webhook might reflect this intermediate state |
| Recovery? | ✅ | Next webhook from Stripe will re-sync to the correct state |

**Issue:** Both the cancel endpoint and the webhook handler update the same subscription row without coordination. In a race between `customer.subscription.updated` (payment processing) and a cancel request, the last writer wins. In practice, Stripe is the ultimate source of truth and the next webhook event will correct the DB state. But there's a window where the DB shows `canceled` while Stripe shows a different state.

**Severity: LOW** — Self-correcting via next webhook. Acceptable for an eventually-consistent system where Stripe is authoritative.

---

## Cross-Cutting Issues

### A. `StripeExceptionFilter` omits `correlationId` from response body

**Affected scenarios:** 1, 2, 3, 10, 11

`AllExceptionsFilter` response body:
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "correlationId": "abc-123",     ← INCLUDED
  "timestamp": "...",
  "path": "/api/v1/..."
}
```

`StripeExceptionFilter` response body:
```json
{
  "statusCode": 402,
  "message": "Payment declined: ...",
  "stripeRequestId": "req_xxx",    ← INCLUDED
  "timestamp": "...",
  "path": "/api/v1/..."
  // ← correlationId MISSING
}
```

**Impact:** Any client relying on the JSON response body for trace correlation will not find `correlationId` in Stripe error responses. The value IS available via the `x-correlation-id` response header (set by `CorrelationIdMiddleware`), but body-based consumers will miss it.

**Fix:** Add `correlationId: request.correlationId` to the `responseBody` in `StripeExceptionFilter`.

### B. `RequestTimeoutMiddleware` omits `correlationId`

**Affected scenario:** 1

The timeout middleware response:
```json
{
  "statusCode": 503,
  "message": "Request timeout",
  "timestamp": "...",
  "path": "/api/v1/payment-intents"
}
// No correlationId, no stripeRequestId
```

**Fix:** Read `req.correlationId` (set by `CorrelationIdMiddleware` which runs first) and include it in the response.

### C. `retryAfter` in JSON body instead of HTTP `Retry-After` header

**Affected scenarios:** 3 (and 1 for connection errors)

`StripeExceptionFilter` sets `responseBody.retryAfter = 5` — this is a JSON field, not an HTTP header. Standards-compliant clients (HTTP libraries, load balancers, CDNs) look for the `Retry-After` HTTP header.

**Fix:** Set `response.setHeader('Retry-After', '5')` on the HTTP response, AND keep the body field for API clients that read the JSON.

### D. Hardcoded `retryAfter: 5` ignores Stripe's actual value

**Affected scenario:** 3

Stripe's rate limit response includes a `Retry-After` header indicating the actual wait time. The Stripe Node.js SDK's `StripeRateLimitError` does not expose this header via its properties. The value `5` is hardcoded and may not match Stripe's actual recommendation.

**Workaround:** The `StripeRateLimitError` may have a `headers` property on the raw response. If available, extract it; otherwise, document that the value is a default fallback.

### E. `StripeExceptionFilter` catches subtypes that no longer exist in SDK v17

**Affected scenarios:** All Stripe errors

The filter uses `instanceof` checks for these types:
- `Stripe.errors.StripeIdempotencyError` — **deprecated/removed** in recent SDK versions. Idempotency errors are now `StripeInvalidRequestError`.
- `Stripe.errors.StripeConnectionError` — may map to network errors thrown as generic `Error` or `StripeError`.

If a removed type is thrown, the `else` clause catches it → 500 "An unexpected payment error occurred" instead of the intended 409 or 503. Verify which error classes actually exist in `stripe@^17.4.0`.

### F. No circuit breaker for Stripe API or Oracle

Neither the Stripe SDK calls nor Oracle queries have a circuit breaker. If Stripe is degraded for an extended period, every request will spend the full timeout + retry budget before failing. This amplifies the impact of upstream outages on application resources (thread pool, event loop, memory).

---

## Summary Table

| # | Scenario | Status | Status Code | correlationId | stripeRequestId | Severity |
|---|---|---|---|---|---|---|
| 1 | Stripe timeout >30s | ⚠️ RACE | 503 (middleware) or 503 (filter) | ❌ Missing (middleware) / ✅ (filter, if it wins) | ❌ Missing (middleware) / ✅ (filter, if it wins) | **HIGH** |
| 2 | 402 card_declined | ✅ | 402 | ❌ Missing in body | ✅ | MEDIUM |
| 3 | 429 rate limit | ⚠️ | 429 | ❌ Missing in body | ✅ | **HIGH** |
| 4 | Oracle pool exhausted | ✅ | 500 | ✅ | N/A | MEDIUM |
| 5 | ORA-00060 deadlock | ✅ | 500 | ✅ | N/A | MEDIUM |
| 6 | Redis sentinel failover | ⚠️ | N/A (fail-open) | N/A | N/A | MEDIUM |
| 7 | BullMQ backpressure | ✅ | 200 (immediate) | N/A | N/A | LOW |
| 8 | Invalid JSON webhook body | ✅ | 400 | ✅ | N/A | LOW |
| 9 | Invalid amounts | ✅ | 400 | ✅ | N/A | NONE |
| 10 | Unsupported currency | ✅ | 400 | ❌ Missing in body | ✅ | LOW |
| 11 | Detached payment method | ✅ | 400 | ❌ Missing in body | ✅ | NONE |
| 12 | Cancel + webhook race | ⚠️ | N/A (DB state) | N/A | N/A | LOW |

---

## Recommendations (in priority order)

1. **Add `correlationId` to `StripeExceptionFilter` response body** (affects scenarios 2, 3, 10, 11, half of 1)
2. **Add `correlationId` to `RequestTimeoutMiddleware` 503 response** (affects scenario 1)
3. **Set HTTP `Retry-After` header** (not just JSON body) in `StripeExceptionFilter` for rate-limit and connection errors (scenario 3, 1)
4. **Extract actual `Retry-After` from Stripe response** instead of hardcoding `5` (scenario 3)
5. **Verify Stripe SDK v17 error class hierarchy** — ensure `instanceof` checks match available types
6. **Add transaction-level optimistic concurrency** (version column) on subscription updates for scenario 12
7. **Configure ioredis with sentinel support** if Redis Sentinel is in use (scenario 6)
8. **Add circuit breaker** (e.g., `opossum`) around Stripe API calls and Oracle queries to prevent resource exhaustion during upstream outages
9. **Add `INSERT ... WHERE NOT EXISTS` or unique constraint** for subscription deduplication (scenario 5)
