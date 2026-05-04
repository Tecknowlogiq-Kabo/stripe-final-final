# Code Quality Report

Generated: 2026-05-04
Analysis scope: Full-stack production-hardening review

## Summary

| Category | Issues Found | Status |
|---|---|---|
| Security — Critical | 7 | ✓ Fixed (6) + Blocked on Auth (1) |
| Security — High | 5 | ✓ Fixed |
| Database | 10 indexes missing | ✓ Fixed (migration 002) |
| Performance | 4 | ✓ Fixed (pagination + log rotation) |
| Frontend | 6 | ✓ Fixed |
| Operational | 3 | ✓ Fixed |
| **Auth (blocker)** | All endpoints unauthenticated | ✓ Implemented (Phase 4) |

---

## Security

### Fixed

| ID | File | Issue | Fix |
|---|---|---|---|
| SEC-01 | `customers.service.ts:42` | ConflictException exposed user email in message (PII leak) | Changed to generic message |
| SEC-02 | `customers.service.ts:58` | Log entry included `email` field in plaintext (PII leak) | Removed email from log |
| SEC-03 | `main.ts` | No body size limit — DoS via oversized payload | Added `express.json({ limit: '100kb' })` |
| SEC-04 | `main.ts:40` | Helmet CSP `imgSrc` included `https:` wildcard | Tightened to `'self'` and `data:` only |
| SEC-05 | `main.ts:41` | Helmet CSP `styleSrc` had `unsafe-inline` (API serves JSON, not HTML) | Removed `unsafe-inline` |
| SEC-06 | `next.config.mjs` | No security headers on frontend (missing X-Frame-Options, CSP, HSTS, etc.) | Added `headers()` with full header set |
| SEC-07 | `reporting.controller.ts:24` | `customerId` param lacked `ParseUUIDPipe` — arbitrary string passed to SQL | Added `ParseUUIDPipe` |
| SEC-08 | `checkout/page.tsx` | `searchParams` (amount, currency, customerId) used raw without validation | Added regex validation + UUID check |

### Implemented (Phase 4)

| ID | File | Issue | Fix |
|---|---|---|---|
| SEC-09 | All controllers | No authentication — all endpoints publicly accessible | JWT `JwtAuthGuard` as global `APP_GUARD` |
| SEC-10 | `baseApi.ts` | No Authorization header in RTK Query requests | `prepareHeaders` injects Bearer token |

---

## Database

### Fixed via Migration 002

| Index | Table | Purpose |
|---|---|---|
| `IDX_CUSTOMERS_EMAIL` | `STRIPE_CUSTOMERS` | Duplicate email check on every customer create |
| `IDX_CUSTOMERS_IS_DELETED` | `STRIPE_CUSTOMERS` | Soft-delete filter on every query |
| `IDX_CUSTOMER_IDEMPOTENCY` | `STRIPE_CUSTOMERS` | Idempotency key lookup on every write |
| `IDX_PI_IDEMPOTENCY` | `STRIPE_PAYMENT_INTENTS` | Idempotency key lookup |
| `IDX_PI_CUSTOMER_CREATED` | `STRIPE_PAYMENT_INTENTS` | Reporting composite query (customer + date range) |
| `IDX_SI_IDEMPOTENCY` | `STRIPE_SETUP_INTENTS` | Idempotency key lookup |
| `IDX_SUB_CUSTOMER_STATUS` | `STRIPE_SUBSCRIPTIONS` | `listByCustomer` filtered by status |
| `IDX_PLANS_IS_ACTIVE` | `SUBSCRIPTION_PLANS` | `listPlans(activeOnly=true)` on every plans page load |
| `IDX_WH_EVENT_TYPE_STATUS` | `STRIPE_WEBHOOK_EVENTS` | Webhook health reporting composite |

### Schema Fix

| Item | Fix |
|---|---|
| `STRIPE_WEBHOOK_EVENTS` missing `UPDATED_AT` column | Added via migration 002 + `@UpdateDateColumn` in entity |

---

## Performance

| ID | File | Issue | Fix |
|---|---|---|---|
| PERF-01 | `subscriptions.service.ts` | `listByCustomer` returned all records unbounded | Paginated via `findAndCount` + `PaginationDto` |
| PERF-02 | `payment-methods.service.ts` | `listByCustomer` returned all records unbounded | Paginated via `findAndCount` + `PaginationDto` |
| PERF-03 | `winston.config.ts` | File transports had no size limit — unbounded disk growth | Added `maxsize` + `maxFiles` |
| PERF-04 | `app.module.ts` | Single global throttle for all endpoints | Named `payment` throttler (20/60s) on financial writes |

---

## Frontend

| ID | File | Issue | Fix |
|---|---|---|---|
| FE-01 | `next.config.mjs` | No security headers | Added full header set |
| FE-02 | `checkout/page.tsx` | Raw searchParams used without validation | Regex validation + UUID check |
| FE-03 | `app/` | No `error.tsx` files — unhandled errors caused full-page crash | Created 5 error boundaries |
| FE-04 | `app/` | No `loading.tsx` files | Created root skeleton loading state |
| FE-05 | `package.json` | 4 unused dependencies in bundle (`@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`) | Removed from `package.json` |
| FE-06 | `tsconfig.json` | Missing path alias for `@stripe-integration/shared-types` | Added to `paths` |

---

## Operational

| ID | File | Issue | Fix |
|---|---|---|---|
| OPS-01 | `main.ts` | No `unhandledRejection` process handler | Added `process.on('unhandledRejection', ...)` |
| OPS-02 | No CI/CD | No automated lint/build/test on push | Added `.github/workflows/ci.yml` |
| OPS-03 | No API docs | No Swagger in development | Added `@nestjs/swagger` setup (dev-only) |

---

## Remaining Recommendations (Not Yet Implemented)

These items were identified but deferred:

| Priority | Item | Notes |
|---|---|---|
| P2 | Ownership verification | Users should only access their own customer data. Requires auth user → customer mapping. |
| P2 | Caching for subscription plans | Plans rarely change; a short Redis TTL would avoid DB reads on every load. |
| P3 | Sentry error tracking | Add `@sentry/nestjs` + `@sentry/nextjs` for production error visibility. |
| P3 | Refresh token support | Current JWT is 15min access-only. Add refresh tokens for better UX. |
| P3 | Structured request logging | Log incoming request method/path/status code in `LoggingInterceptor`. |
