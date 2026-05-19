# Code Quality Review: Observability Implementation

**Date:** 2026-05-19
**Scope:** 12 files across instrumentation, logging, metrics, filters, health, and config

---

## 1. `apps/api/src/instrumentation.ts`

### Correct
- Auto-instrumentation bootstrapped before any other import — this is the correct OTel pattern (L1-L9).
- Fs instrumentation disabled to avoid `fs` span noise (L22).
- SDK started before bootstrap completes (L26).

### Blocker: Missing SIGINT handler — OTel spans lost on Ctrl+C
**Severity: HIGH** | **Lines 28-30**

```ts
process.on('SIGTERM', () => {
  sdk.shutdown().catch(console.error);
});
```

`main.ts` registers both `SIGTERM` and `SIGINT` handlers (L127-128), but `instrumentation.ts` only handles `SIGTERM`. When the process receives `SIGINT` (e.g., `docker stop` default signal, `Ctrl+C` in dev), the OTel SDK never calls `shutdown()`. The `BatchSpanProcessor` flushes on shutdown — without it, the last batch of spans (up to 512 spans or 5 seconds of data) is silently lost.

**Fix:** Add SIGINT handling (and `SIGTERM` should also call `process.exit` after shutdown to prevent hanging):

```ts
const gracefulShutdown = async () => {
  await sdk.shutdown();
  process.exit(0);
};
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

### Note: No resource detectors
**Severity: MEDIUM** | **Lines 14-26**

The SDK config sets `serviceName` but includes no `resourceDetectors`. In production, missing resource attributes make tracing hard to correlate:
- `host.name` — which machine served the request
- `deployment.environment` — `production`/`staging`/`development`
- `service.instance.id` — distinguishes multiple instances of the same service

Without these, Jaeger/Tempo cannot group traces by host during incident response.

**Fix:** Import and configure resource detectors:

```ts
import { envDetector, hostDetector, processDetector } from '@opentelemetry/resources';
import { detectResources } from '@opentelemetry/resources';

const sdk = new NodeSDK({
  resourceDetectors: [envDetector, hostDetector, processDetector],
  // ...
});
```

### Note: No explicit span processor / batching configuration
**Severity: LOW** | Uses `NodeSDK` defaults (which include `BatchSpanProcessor` with reasonable defaults: 512 max queue, 5s schedule delay, 2048 max export batch). This is acceptable but worth documenting. If the OTLP collector is under high load, these defaults may need tuning.

---

## 2. `apps/api/src/main.ts`

### Correct
- `import './instrumentation'` is the very first import (L2) — correct OTel bootstrap.
- Sentry initialization is conditional on DSN presence (L33-40) — won't crash if DSN is missing.
- Graceful shutdown with `app.close()` drains pending requests (L116-121).
- Unhandled rejection handler drains gracefully instead of `process.exit(1)` immediately (L133-145) — this prevents corrupting in-flight Stripe operations.
- Keep-alive/timeout tuned for AWS ALB (L114-115).
- Helmet CSP scoped to Stripe origins (L56-71).

### Note: Sentry.init() not wrapped in try/catch
**Severity: LOW** | **Lines 37-40**

If `Sentry.init()` throws (e.g., invalid DSN format, network error during Sentry SDK initialization), it crashes `bootstrap()` → `process.exit(1)`. This is unlikely but would prevent the app from starting even if Sentry is non-critical.

**Fix:** Wrap in try/catch and log a warning:

```ts
if (sentryDsn) {
  try {
    Sentry.init({ dsn: sentryDsn, environment: nodeEnv, tracesSampleRate: nodeEnv === 'production' ? 0.1 : 1.0 });
  } catch (err) {
    console.error('Sentry initialization failed — continuing without error tracking', err);
  }
}
```

### Note: `process.exit(0)` in graceful shutdown may be premature
**Severity: LOW** | **Lines 120-121**

The `gracefulShutdown` calls `process.exit(0)` after `app.close()`. If the OTel SDK is still flushing spans (it has its own shutdown timer of ~5s), the process may exit before all spans are exported. Since `instrumentation.ts` has its own `SIGTERM` handler that also calls `sdk.shutdown()`, and both handlers fire on the same signal, there's a race: whose shutdown finishes first?

**Fix:** Coordinate shutdown. Either have `main.ts` await `sdk.shutdown()` before `process.exit()`, or remove the `process.exit()` from the OTel shutdown and let `main.ts` control the exit.

---

## 3. `apps/api/src/logging/logger.module.ts`

### Correct
- `autoLogging: true` replaces the need for a manual logging interceptor (L12).
- `genReqId` picks up `req.id` from `CorrelationIdMiddleware` (L16) — ensures consistent request ID across the entire request lifecycle.
- Redaction of sensitive headers (`authorization`, `cookie`, `stripe-signature`) and query params (`email`, `token`) (L24-32).
- Environment-aware transport: pretty-print in dev, structured JSON + rotating files in prod (L33-47).
- Production file rotation (`pino-roll`) with size limits and max file count (L38-46).

### Note: Mixin extracts span context on every log line — minor overhead
**Severity: LOW** | **Lines 18-22**

The mixin is invoked for **every** pino log call in the request (including debug logs inside hot paths). `trace.getActiveSpan()` reads from `AsyncLocalStorage`, which is fast (~microseconds), but it still adds overhead on every `logger.info()` call in high-throughput handlers.

**Evidence:** In a request handler with 10 log calls, `trace.getActiveSpan()` is called 10 times. In a service with 10K RPS, that's 100K AsyncLocalStorage lookups per second. This is generally fine (AsyncLocalStorage is optimized in Node.js 20+), but worth monitoring.

**Suggestion:** Consider caching the span context in `req` or `AsyncLocalStorage` at the start of the request and reading it from there in the mixin to avoid the repeated `trace.getActiveSpan()` call.

### Note: Redaction is pino-level only — log sanitization is not applied to error stack traces
**Severity: LOW** | **Lines 24-32**

`pinoHttp` redacts fields in the serialized request object, but if a developer manually logs `logger.error({ headers: req.headers })`, the headers are NOT redacted because pino redaction only applies to the auto-logged request/response. Developers must use `sanitizeFields()` from `sanitize.ts` explicitly.

---

## 4. `apps/api/src/logging/sanitize.ts`

### Correct
- Comprehensive sensitive field list (L3-7) covering passwords, tokens, API keys, Stripe keys, DB URLs, private keys.
- Case-insensitive matching via `k.toLowerCase()` (L13).
- Recursive sanitization of nested objects (L15-16).
- `maskEmail` for partial redaction of emails (L26-28).
- `sanitizePath` strips query strings and fragments (L30-33) — critical for preventing PII in URL paths.

### Bug: `sanitizePath` could leak path segments containing IDs
**Severity: LOW** | **Lines 30-33**

`sanitizePath('/api/v1/customers/cus_abc123/payment-methods')` returns the full path unchanged. While this doesn't expose query params, it exposes resource IDs (Stripe customer IDs) in log paths. This is a minor concern since Stripe IDs are not personally identifiable, but it could be a compliance issue under certain data classification policies.

### Note: No test file for sanitization edge cases
**Severity: MEDIUM** | No `sanitize.spec.ts` exists. Edge cases worth testing:
- Nested sensitive fields (e.g., `{ config: { stripe_secret_key: 'sk_live_...' } }`)
- Arrays containing objects with sensitive fields
- `null` and `undefined` values
- Very deeply nested objects (stack overflow potential? — recursion depth is unbounded)
- Circular references (would cause infinite recursion → RangeError)

The recursive `sanitizeFields` has no depth limit and no circular reference guard. A circular object passed to it would cause a stack overflow.

**Fix:** Add depth guard and circular reference detection:

```ts
const MAX_DEPTH = 10;
export function sanitizeFields(obj: Record<string, unknown>, depth = 0, seen = new WeakSet()): Record<string, unknown> {
  if (depth > MAX_DEPTH) return { error: '[MAX_DEPTH_EXCEEDED]' };
  if (typeof obj !== 'object' || obj === null) return obj;
  if (seen.has(obj)) return { error: '[CIRCULAR]' };
  seen.add(obj);
  // ... rest of implementation passing depth+1 and seen
}
```

---

## 5. `apps/api/src/metrics/metrics.service.ts`

### Correct
- `collectDefaultMetrics()` collects Node.js runtime metrics (event loop lag, heap, GC) — essential for diagnosing runtime issues (L10).
- Histogram buckets are well-chosen for API latencies (0.01s to 10s) (L16).
- Three distinct metric types: Histogram for duration, Counter for total requests, Counter for errors (L12-31).
- Prefix `stripe_` avoids collisions with other libraries that may register prom-client metrics (L10).

### Note: `register.metrics()` can throw — no error handling
**Severity: LOW** | **Lines 37-39**

`register.metrics()` from prom-client can throw if there's a metric serialization issue (rare, but possible with corrupted internal state). The `MetricsController.getMetrics()` calls this without try/catch, which would result in a 500 error from NestJS. The scrape endpoint should degrade gracefully.

**Fix:** Wrap in try/catch:

```ts
async getMetrics(): Promise<string> {
  try {
    return await register.metrics();
  } catch (err) {
    return '# ERROR: Failed to collect metrics\n';
  }
}
```

### Note: High-cardinality label `route` — acceptable but monitor
**Severity: LOW** | **Lines 13-15, 19-21, 24-26**

All three metrics use `route` as a label. Express parameterized routes (e.g., `/api/v1/customers/:id`) control cardinality. However, if any route uses regex or wildcard patterns without parameterization, each unique URL creates a new time series. The `'unknown'` fallback (from `metrics.interceptor.ts`) consolidates unmatched routes into a single label — this is actually good for cardinality but masks visibility into 404s.

**Recommendation:** Add a separate counter for `unknown` routes with full path logging (not as a label).

---

## 6. `apps/api/src/metrics/metrics.controller.ts`

### Blocker: Missing `@Public()` decorator — metrics endpoint behind authentication
**Severity: HIGH** | **Lines 1-12**

The `HealthController` uses `@Public()` to bypass the global `JwtAuthGuard`. The `MetricsController` does **not**. Since `JwtAuthGuard` is applied globally (app.module.ts L97), the `/api/v1/metrics` endpoint requires a valid JWT. Prometheus cannot scrape it without injecting an auth token.

This may be intentional (security: metrics may contain sensitive data), but if Prometheus scraping is expected, this is a blocker.

**Fix:** Either add `@Public()` or document that Prometheus must use bearer token auth. If public, consider adding a separate internal-only metrics port or IP allowlisting.

### Note: Using `@Res()` with `res.send()` bypasses NestJS interceptors
**Severity: LOW** | **Lines 10-11**

When `@Res()` is used, NestJS skips its response pipeline. The `MetricsInterceptor` would still fire (it's request-scoped), but the response won't go through NestJS serialization. This is fine for text/plain metrics, but worth noting that the response won't be wrapped in the standard JSON envelope.

---

## 7. `apps/api/src/metrics/metrics.module.ts`

### Correct
- `@Global()` makes `MetricsService` available everywhere without importing `MetricsModule` in each feature module (L5).
- `MetricsService` is exported, allowing other modules to inject it directly (L8).

### Note: `@Global()` with `collectDefaultMetrics()` — no memory leak
**Severity: INFO** | `collectDefaultMetrics()` is called once in the `MetricsService` constructor (a singleton). The timers created by prom-client are managed internally and cleaned up on process exit. No memory leak risk. The `@Global()` decorator does not affect this — it only controls DI visibility, not instantiation count.

---

## 8. `apps/api/src/common/interceptors/metrics.interceptor.ts`

### Correct
- Uses `tap()` to record metrics after response (both success and error paths) (L20-30).
- Extracts HTTP method and route for labeling (L18-19).
- Records both duration and error count on error (L26-28).
- Duration in seconds matches the Histogram bucket units (L23, L27).

### Bug: `Date.now()` for duration — susceptible to clock skew
**Severity: MEDIUM** | **Lines 18, 23, 27**

`Date.now()` uses the system clock, which can jump backwards or forwards due to NTP adjustments. This can produce negative duration values (which prom-client rejects or produces incorrect histogram buckets). For precision timing, use `process.hrtime.bigint()` or `performance.now()`.

**Evidence:** NTP can adjust the clock by milliseconds during normal operation and by seconds during initial sync. If a request starts at `Date.now() = 1000` and NTP adjusts the clock to `995` during the request, the duration becomes `995 - 1000 = -5ms`, which is invalid.

**Fix:**

```ts
const start = process.hrtime.bigint();
// ...
const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
const durationSeconds = durationMs / 1000;
```

### Bug: `request.route?.path` — undefined for middleware-level routes
**Severity: MEDIUM** | **Line 19**

`request.route` is only populated by Express when a route handler is matched (i.e., after `router.handle()` runs). For requests that:
- Hit middleware-level routes without a matching handler
- Are rejected by a guard/interceptor before reaching the route handler
- Are 404s

`request.route` is `undefined`, and the `'unknown'` fallback is used. This is functional but means:
1. All 404 errors are grouped under `method="GET", route="unknown"` — no visibility into which 404s are common.
2. Requests rejected by JwtAuthGuard (401) before route resolution also get `route="unknown"`.

**Suggestion:** Use `request.path` (normalized path) or `request.originalUrl` as a secondary label for debugging, but keep `'unknown'` for metric cardinality. Or record 401/404 metrics separately.

---

## 9. `apps/api/src/common/filters/all-exceptions.filter.ts`

### Correct
- Double-response guard prevents `ERR_HTTP_HEADERS_SENT` crashes (L21-28).
- Handles `entity.parse.failed` (body parser error) and 413 (payload too large) explicitly (L37-40).
- Full error logging with correlation ID and sanitized path for unhandled errors (L42-50).
- Response includes `correlationId` for client-side error correlation (L55).

### Blocker: `@Catch()` with no arguments catches ALL exceptions BEFORE StripeExceptionFilter
**Severity: CRITICAL** | **Lines 1-13**

The `AllExceptionsFilter` uses `@Catch()` (no arguments), which makes it a catch-all filter. In `app.module.ts`, it is registered **before** `StripeExceptionFilter`:

```ts
// app.module.ts L91-93
{ provide: APP_FILTER, useClass: AllExceptionsFilter },   // first → outermost
{ provide: APP_FILTER, useClass: StripeExceptionFilter }, // second → innermost
```

NestJS iterates global exception filters in registration order. When `@Catch()` matches everything, the **first** filter in the chain catches ALL exceptions. StripeExceptionFilter is **dead code** — it never executes.

**Evidence:** NestJS `@Catch()` with no arguments sets `__filterCatchExceptions__` to `[]` (empty array), which NestJS treats as "match any exception type." The `ExternalExceptionsHandler` invokes the first matching filter and stops.

**Impact:** All Stripe API errors (card declines, authentication errors, rate limits, idempotency conflicts, connection errors) are caught by `AllExceptionsFilter` and returned as generic `500 Internal Server Error` (the else branch at L41-43). Stripe-specific error responses (402 for card declines, Retry-After headers, stripeRequestId in response, etc.) are **never** sent.

**Fix:** Reverse the filter order in `app.module.ts`:

```ts
// More specific filters FIRST
{ provide: APP_FILTER, useClass: StripeExceptionFilter },
{ provide: APP_FILTER, useClass: AllExceptionsFilter },
```

This ensures:
1. Stripe errors → StripeExceptionFilter (specific handling)
2. HttpExceptions → AllExceptionsFilter (standard handling)
3. Everything else → AllExceptionsFilter (catch-all, logs full error)

### Note: Catches and handles HttpExceptions — NestJS built-in handling bypassed
**Severity: LOW** | **Lines 30-36**

The filter correctly extracts `status` and `message` from `HttpException` via `exception.getStatus()` and `exception.getResponse()`, so it doesn't break NestJS's exception handling — it just takes over responsibility. This is acceptable as long as the behavior is consistent. Risk: if NestJS adds new exception response formats in future versions, this manual extraction may miss them.

---

## 10. `apps/api/src/common/filters/stripe-exception.filter.ts`

### Correct
- `@Catch(Stripe.errors.StripeError)` catches all Stripe error subtypes (L11). All 11+ Stripe error classes extend `StripeError` (verified via SDK inspection).
- Comprehensive classification of Stripe error types (L50-81):
  - `StripeCardError` → 402 with decline code (L50-54)
  - `StripeInvalidRequestError` → 400 (L56-58)
  - `StripeIdempotencyError` → 409 (L59-61)
  - `StripeAuthenticationError` → 500 (never exposed) (L62-64)
  - `StripePermissionError` → 403 (L66-68)
  - `StripeRateLimitError` → 429 with Retry-After from Stripe's response headers (L69-73)
  - `StripeConnectionError` → 503 with Retry-After (L73-76)
  - `StripeAPIError` → 502 with Retry-After (L77-79)
- Uses Stripe's actual `retry-after` header when available (L91-93) instead of a hardcoded value.
- Double-response guard present (L22-29).
- `stripeRequestId` always logged for Stripe support correlation (L33-36).
- `decline_code` appended for card errors (L41-43).

### Bug: Missing error type handling causes generic 500 for some Stripe errors
**Severity: MEDIUM** | **Lines 79-81**

The if/else chain covers 7 error types but misses these StripeError subtypes:
- **`Stripe.errors.StripeSignatureVerificationError`** — webhook signature failures. If this bubbles up as an uncaught exception (rather than being caught in the webhook handler), it gets a misleading 500 "An unexpected payment error occurred."
- **`Stripe.errors.StripeInvalidGrantError`** — OAuth grant errors (Connect). Falls to 500.
- **`Stripe.errors.StripeUnknownError`** — SDK internal errors. Falls to 500.

**Fix:** Add explicit cases:

```ts
} else if (exception instanceof Stripe.errors.StripeSignatureVerificationError) {
  status = HttpStatus.BAD_REQUEST;
  userMessage = 'Webhook signature verification failed.';
} else if (exception instanceof Stripe.errors.StripeInvalidGrantError) {
  status = HttpStatus.BAD_REQUEST;
  userMessage = 'Invalid authorization grant.';
} else {
  status = HttpStatus.INTERNAL_SERVER_ERROR;
  userMessage = 'An unexpected payment error occurred.';
}
```

### Note: Network errors from Stripe SDK ARE caught
**Severity: INFO**

The review prompt asks about "network errors, timeouts from Stripe SDK." `Stripe.errors.StripeConnectionError` **extends** `StripeError` and IS caught by `@Catch(Stripe.errors.StripeError)`. Raw Node.js socket errors (ECONNREFUSED, ETIMEDOUT) that occur before Stripe SDK classifies the error would be thrown as non-Stripe Error objects, but those would be caught by `AllExceptionsFilter` (once the ordering bug is fixed).

---

## 11. `apps/api/src/health/health.controller.ts`

### Correct
- `@Public()` allows unauthenticated health checks (L24).
- Uses `@HealthCheck()` terminator decorator (L26).
- Checks: database (TypeORM), external Stripe API, and Redis (L27-37).
- Custom Redis health indicator with proper status mapping (L32-36).

### Note: Stripe healthcheck endpoint may not exist or may be rate-limited
**Severity: LOW** | **Lines 29-31**

The `https://api.stripe.com/healthcheck` endpoint is used for the HTTP health check. If Stripe deprecates or rate-limits this endpoint, health checks will fail and trigger unnecessary alerts. Confirm this endpoint is documented/supported by Stripe. Alternatives: use `https://api.stripe.com/v1/balance` (pings Stripe API without side effects) or skip the external Stripe health check entirely.

### Note: No test file for HealthController
**Severity: LOW** | No `health.controller.spec.ts` exists. The health endpoint is critical for orchestration (Kubernetes liveness/readiness probes), so it should have at least a unit test verifying the response structure.

---

## 12. `apps/api/src/config/configuration.ts`

### Correct
- Defaults provided for all configuration values (prevents crashes on missing env vars).
- JWT rotation support via `JWT_PREVIOUS_SECRET` (L40-44) — documented with rotation procedure in comments.
- Stripe API version locked to a specific date (`2026-03-25.dahlia`) with env override (L17) — prevents breaking changes from Stripe API updates.
- Sensible throttle defaults (60s TTL, 100 requests) (L23-24).

### Note: No validation of `JWT_SECRET` presence in production
**Severity: LOW** | **Line 40**

`jwt.secret` defaults to `undefined` (no fallback). If `JWT_SECRET` is not set in production, the app starts but JWT signing/verification will fail at runtime. The `validation.schema` (referenced in app.module.ts L49) likely validates this, but it's not visible in this file. Verify that the validation schema enforces `JWT_SECRET` in production.

### Note: `encryption.key` not validated
**Severity: LOW** | **Line 52**

Same issue — missing encryption key causes runtime failures when encrypting/decrypting sensitive data. Ensure validation schema requires this in production.

---

## Cross-Cutting Issues

### Missing Observability for Dependencies

| Dependency | Current Status | Risk |
|---|---|---|
| **BullMQ** | No job completion/failed/delayed counters | No visibility into queue health; cannot alert on job backlog |
| **TypeORM** | No query duration metrics | Cannot detect slow queries; no database performance baselines |
| **Stripe SDK** | No custom spans wrapping API calls | Can't trace Stripe API latency in distributed traces; can't correlate Stripe request IDs with spans |
| **Redis** | Health check only (ping) | No latency/error rate metrics for Redis operations |

### Testing Gaps

| Component | Test File | Status |
|---|---|---|
| `metrics.service.ts` | ❌ Missing | Unit test for metric registration and collection |
| `metrics.interceptor.ts` | ❌ Missing | Unit test for route resolution and timing |
| `all-exceptions.filter.ts` | ❌ Missing | Unit test for HttpException, unknown error, and double-response guard |
| `stripe-exception.filter.ts` | ❌ Missing | Unit test for each Stripe error type and Retry-After behavior |
| `health.controller.ts` | ❌ Missing | Unit test for health check response |
| `sanitize.ts` | ❌ Missing | Unit test for edge cases (circular refs, nesting, sensitive fields) |
| `metrics.controller.ts` | ❌ Missing | Integration test for Prometheus metrics endpoint |
| `metrics.controller.ts` | ❌ Missing | Test for `@Public()` or auth on metrics endpoint |

### Error Handling in Prometheus Export Path

No error handling exists if:
- `register.metrics()` throws (metrics.service.ts L38)
- OTel exporter fails persistently (instrumentation.ts L13 — relies on BatchSpanProcessor retry)
- pino-roll file rotation fails (logger.module.ts L38-46 — pino-roll has internal error handling, but no alerting)

### Stale comment in app.module.ts

**app.module.ts L91:**
```ts
// Order matters: more specific filters first
```
This comment is misleading. The filters are registered as `[AllExceptionsFilter, StripeExceptionFilter]` — the catch-all filter comes **before** the specific filter. If the filter ordering bug is fixed (StripeExceptionFilter first), this comment would be correct.

---

## Summary: Issues by Severity

| Severity | Count | Key Issues |
|---|---|---|
| **CRITICAL** | 1 | AllExceptionsFilter catch-all blocks StripeExceptionFilter (dead code) |
| **HIGH** | 2 | OTel SIGINT handler missing; Metrics endpoint behind auth |
| **MEDIUM** | 5 | Date.now() for timing; no resource detectors; missing Stripe error types; no sanitize tests; `request.route?.path` fallback |
| **LOW** | 9 | Sentry.init try/catch; pino redact scope; sanitizePath IDs; metrics().catch; process.exit race; Stripe healthcheck stability; config validation; dependency instrumentation gaps |

### Recommended Fix Order

1. **CRITICAL:** Reverse filter order in `app.module.ts` (StripeExceptionFilter before AllExceptionsFilter) — 1 line change, prevents loss of all Stripe-specific error handling
2. **HIGH:** Add SIGINT handler in `instrumentation.ts` — prevents span loss on container shutdown
3. **HIGH:** Add `@Public()` to MetricsController or document auth requirement
4. **MEDIUM:** Replace `Date.now()` with `process.hrtime.bigint()` in `MetricsInterceptor`
5. **MEDIUM:** Add resource detectors to `instrumentation.ts`
6. **MEDIUM:** Add missing Stripe error types to `StripeExceptionFilter`
7. **Everything else** — testing, config validation, dependency instrumentation
