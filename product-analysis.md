# Product Architecture Analysis — Stripe Integration App

**Date:** 2026-05-19  
**Assessor:** Product Architecture Lead  
**Methodology:** Full-stack codebase audit mapping PRD features against implementation reality.

---

## Overall Product Readiness Score: 5.2 / 10

| Dimension | Score | Assessment |
|-----------|-------|------------|
| Core Payment Flows | 8/10 | One-time payments, checkout, success/failure states — solid |
| Subscription Management | 7/10 | Plans, cancel/reactivate, billing portal — functional |
| Payment Method Management | 7/10 | Setup Intents, detach, set-default — works well |
| Webhook Event Coverage | 6/10 | 26 events registered, but 2 silent no-ops; no notifications |
| Missing Stripe Capabilities | 2/10 | No refunds, disputes, invoices surfaced to users |
| Admin / Reporting | 3/10 | 7 rich analytics APIs — zero UI, no admin role |
| Multi-tenancy | 1/10 | Single-tenant; no merchant/organization concept |
| Error Handling | 6/10 | Good frontend error recovery; Redis crash = 500 cascade |
| Auth & Session | 4/10 | Works but 15-min hard expiry; no refresh tokens |
| Mobile / Responsive | 2/10 | Desktop-only fixed sidebar; no PWA; zero responsive breakpoints |
| Test Coverage | 3/10 | 11 tests exist (7 API + 4 E2E) — zero frontend component tests |
| Security & RBAC | 5/10 | JWT auth functional; missing user→customer ownership FK |

---

## 1. Feature Completeness Mapping

### Stripe Capabilities: Exposed vs. Missing

| Stripe Capability | Status | Implementation Detail |
|-------------------|--------|----------------------|
| **Payment Intents** | ✅ Exposed | Full CRUD: create, retrieve, cancel, list-by-customer. Controller: `apps/api/src/payment-intents/payment-intents.controller.ts`. Frontend checkout flow at `apps/web/src/app/checkout/page.tsx` with AmountEntry → CheckoutForm two-step wizard. |
| **Setup Intents** | ✅ Exposed | Create via `apps/web/src/actions/setup-intents.ts`. SetupForm component at `apps/web/src/components/stripe/SetupForm.tsx`. Integrates into payment-methods page. |
| **Customer Management** | ✅ Exposed | Create/edit via `apps/web/src/app/account/page.tsx`. Customer sessions API (`POST /customers/:id/customer-sessions`). Sync from Stripe. |
| **Payment Methods** | ✅ Exposed | List, detach, set-default via `apps/web/src/app/payment-methods/page.tsx`. Supports 28 payment method type labels (card, SEPA, ACH, iDEAL, Klarna, PayPal, Cash App, etc.). |
| **Subscriptions** | ✅ Exposed | Plans listing, subscribe (via checkout with priceId), cancel/reactivate at period end. `apps/web/src/app/subscriptions/page.tsx`. |
| **Billing Portal** | ✅ Exposed | `POST /customers/:id/billing-portal` creates Stripe Customer Portal session. Action at `apps/web/src/actions/billing-portal.ts`. Button on subscriptions page. |
| **Invoices** | ⚠️ Webhook-only | `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.upcoming` handled — but ONLY in webhook handlers. No `GET /invoices` endpoint for users to view their invoices. No frontend invoice page exists. The `invoice.created` and `invoice.finalized` events are registered in the handler registry but fall through the switch statement with no action (silent no-op). |
| **Refunds** | ❌ Missing | Zero mentions of "refund" anywhere in the codebase (grep confirmed). No `RefundsResource` in `StripeService`. No refund controller, no refund endpoint, no refund webhook handler. Users cannot request or view refunds. |
| **Disputes** | ❌ Missing | Zero mentions of "dispute" or "chargeback" in the codebase. No `charge.dispute.*` webhook handlers. Stripe will send these events — they will be logged as "Unhandled webhook event type" and silently discarded. |
| **Products & Prices** | ⚠️ Partial | `StripeService` exposes `products` and `prices` — but no product browsing UI. Plans are fetched from a local `SUBSCRIPTION_PLANS` table (synced from Stripe). No product catalog frontend. |
| **Stripe Connect** | ❌ Missing | No Connect integration. Single-merchant model only. |

### Key Gap: The "Payment Operations" Triangle

A complete Stripe integration needs three operational capabilities post-payment:

```
        PAYMENT
       /   |   \
   REFUND  |  DISPUTE
       \   |   /
        INVOICE
```

The current app handles only the payment intent lifecycle and subscription webhooks. The entire operational triangle (refund, dispute, invoice-facing-user) is absent. This means customer service agents have no tooling for the most common post-payment scenarios.

---

## 2. User Flow Analysis

### Flow: Registration → Login → Add Payment Method → One-time Payment → Subscription → Cancel

| Step | Status | Issues |
|------|--------|--------|
| **Registration** | ✅ Works | `apps/web/src/app/auth/register/page.tsx` — email + password, min 8 chars. Redirects to original destination after login. |
| **Login** | ✅ Works | `apps/web/src/app/auth/login/page.tsx` — JWT issued, stored as httpOnly cookie. Middleware `apps/web/src/middleware.ts` guards all routes except `/`, `/auth/login`, `/auth/register`. |
| **Create Customer** | ⚠️ Edge case gap | `apps/web/src/app/account/page.tsx` properly handles 404 (no customer yet → show create form) vs. success (show edit form) vs. loading (skeleton). Good. But: if two browser tabs both create a customer simultaneously, the idempotency key prevents double Stripe creation, but the frontend race between two tabs isn't handled. |
| **Add Payment Method** | ✅ Works | Payment-methods page uses `useMyCustomer()` (not a hardcoded demo ID — the DEPLOYMENT_READINESS.md report is outdated on this). Handles: no-customer-yet state (shows helpful CTA), empty list, loading skeletons, setup errors, recoverable vs. non-recoverable errors, retry. Covers 28 PM types. |
| **One-time Payment** | ✅ Works | Two-step checkout: `AmountEntryForm` → `CheckoutForm` with Stripe Payment Element. Handles: customer loading, PI creation errors, back navigation. Success page verifies PI status server-side. |
| **Subscription** | ✅ Works | Browse plans → "Subscribe" button links to checkout with priceId. Cancel/reactivate via `PATCH /subscriptions/:id` with `cancelAtPeriodEnd`. Billing Portal integration for complex management. |
| **Session Expiry** | ❌ Broken | JWT expires in 15 minutes. No refresh token. No `POST /auth/refresh`. When the cookie expires: (a) RTK Query calls return 401 with no user-facing redirect, (b) server actions return 401, (c) the user is silently stuck with no recovery path except manual re-login. The middleware redirects on full page navigation, but SPA interactions leave the user in a broken state. |

### Edge Cases NOT Handled

1. **Double-submit prevention**: The checkout page disables the submit button during processing (confirmed in E2E test `checkout.spec.ts`). Good. But the payment-methods page's "Add Payment Method" button has no disable-during-loading state — clicking rapidly could create multiple Setup Intents.

2. **Concurrent subscription cancel/reactivate**: If a user rapidly clicks Cancel → Reactivate, the optimistic cache update in React Query could desync from the server state. The server handles this correctly (idempotency), but the UI may flash incorrect states.

3. **Network offline recovery**: No offline detection. If the network drops during checkout, the user sees a generic error. No retry queue or offline indicator.

4. **Payment method detach of default**: The UI allows detaching the default payment method with no warning. Stripe will reject detaching a PM that's tied to an active subscription — but the error message from the API isn't translated into a user-friendly message on the frontend.

5. **Zero-amount payment intents**: No validation prevents creating a $0.00 PaymentIntent.

6. **Expired Checkout Sessions**: If a user stays on the checkout page too long, the PaymentIntent's client_secret expires. The `StripeProvider` will receive a Stripe error, but the frontend handles this generically rather than suggesting the user go back and restart.

---

## 3. Gap Analysis: Key Priorities

### G1: No Refund or Dispute Handling (P0)

**Evidence:** `grep -rn 'refund\|dispute\|chargeback' apps/api/src/` returns zero results.

**Impact:** This is the single biggest product gap. When a customer requests a refund:
- The business has no in-app tool to process it
- No webhook handlers exist for `charge.refunded`, `charge.refund.updated`, `charge.dispute.*`
- Stripe sends these events → logged as "unhandled event type" and silently discarded
- Database state becomes stale (refunded charges still show as "succeeded")

**Required:**
- `Refund` entity + migration
- `RefundsController` with `POST /payment-intents/:id/refund`
- Webhook handlers for `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.closed`
- Frontend: refund button on payment detail, refund status display

### G2: Invoice Visibility for End Users (P0)

**Evidence:** Five invoice events are in the handler registry (`invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.upcoming`, `invoice.created`, `invoice.finalized`). But the `InvoiceHandler` only handles the first three with actual logic — `invoice.created` and `invoice.finalized` fall through the switch statement (no code handles them). And critically: there is no `GET /invoices` endpoint for users to view their invoices, and no invoices page in the frontend.

**Impact:** Subscription customers cannot see their billing history or download PDF invoices. The Billing Portal partially mitigates this, but it redirects users away from the app.

**Required:**
- `GET /invoices` and `GET /invoices/:id` endpoints
- Frontend invoices page with download links
- Handle `invoice.created` and `invoice.finalized` in the handler (at minimum, log them + update local state)

### G3: No Refresh Tokens — Session Hard Expiry (P0)

**Evidence:** `apps/api/src/auth/auth.service.ts` — `expiresIn: '15m'` hardcoded. No refresh endpoint. `apps/api/src/config/configuration.ts:29` confirms.

**Impact:** Users silently lose access after 15 minutes. SPA interactions break with no redirect. This makes the app unusable for any session longer than 15 minutes.

**Required:**
- `POST /auth/refresh` endpoint
- Refresh token stored in httpOnly cookie (7-day expiry)
- Token rotation on refresh
- Frontend: axios/RTK interceptor that calls refresh on 401

### G4: Redis Circuit Breaker Missing (P0)

**Evidence:** `apps/api/src/redis/redis.service.ts` — `get()` and `set()` call ioredis directly with no try/catch.

**Impact:** If Redis becomes unavailable, every endpoint that uses caching (`GET /customers/:id`, `GET /subscriptions/plans`, all reporting endpoints) throws uncaught exceptions → HTTP 500 cascade.

**Required:** Wrap all Redis operations in try/catch with graceful fallback to DB.

### G5: Invoice Handler — 2 Silent No-Ops (P1)

**Evidence:** `apps/api/src/webhooks/handlers/invoice.handler.ts` switch statement handles only 3 of 5 registered event types. `invoice.created` and `invoice.finalized` are registered in `WebhooksService.handlerRegistry` (lines in the service constructor) but have no corresponding `case` in the handler.

```typescript
// Registered in handlerRegistry:
['invoice.created', invoiceHandler],    // ← NO case in handler switch
['invoice.finalized', invoiceHandler],  // ← NO case in handler switch

// In InvoiceHandler.handle():
switch (event.type) {
  case 'invoice.payment_succeeded': // ✅ handled
  case 'invoice.payment_failed':    // ✅ handled
  case 'invoice.upcoming':          // ✅ handled
  // invoice.created    → falls through, no action
  // invoice.finalized  → falls through, no action
}
```

**Impact:** These events are safely processed (no error thrown), but they're pointless. At minimum, they should be removed from the registry or handled explicitly.

### G6: No Frontend Tests — Zero Component Coverage (P1)

**Evidence:** `CODE_QUALITY_REPORT.md` states "No test files found anywhere in the codebase" — this is now outdated. There are 11 test files:
- 7 API unit tests: `customers.service.spec.ts`, `setup-intents.controller.spec.ts`, `payment-intents.controller.spec.ts`, `payment-intents.service.spec.ts`, `subscriptions.service.spec.ts`, `webhooks.service.spec.ts`, `stripe.service.spec.ts`
- 4 E2E tests: `auth.spec.ts`, `checkout.spec.ts`, `payment-methods.spec.ts`, `subscriptions.spec.ts`

However, **zero frontend component tests** exist. There are no `*.test.tsx` or `*.spec.tsx` files in `apps/web/src/`. Critical components with no test coverage:
- `CheckoutForm.tsx` — payment collection, card validation errors
- `SetupForm.tsx` — payment method setup flow
- `AmountEntryForm.tsx` — amount input validation
- `Sidebar.tsx` — navigation rendering
- All page components

### G7: Reporting Endpoints Without Roles or UI (P1)

**Evidence:** `apps/api/src/reporting/reporting.controller.ts` has 7 endpoints (`revenue-by-month`, `subscribers-by-plan`, `churn`, `customer-ltv`, `failed-payments-by-decline`, `webhook-health`, `cohort-ltv`) — but:

1. **No role-based access control**: Any authenticated user (even a regular customer) can call these endpoints and see aggregate revenue, churn, and cohort data. Only `webhooks/health` is `@Public()` — the rest require auth but have no admin role check.

2. **No frontend dashboard**: There is no `/admin/reports` page or analytics UI. The endpoints exist but are invisible to users. The only way to access them is via direct API calls.

3. **Expensive queries unthrottled**: The `cohort-ltv` endpoint runs Oracle window functions (`SUM() OVER ()`, multi-table joins) without any query-specific rate limiting beyond the global 100/min throttle.

### G8: Unresponsive Design — Desktop Only (P1)

**Evidence:** `apps/web/src/app/globals.css` — zero responsive breakpoints. The layout at `apps/web/src/app/layout.tsx` uses:
```tsx
<aside className="fixed left-0 top-0 h-screen w-60 ..."> // Fixed sidebar
<div className="ml-60 min-h-screen">                       // Content offset
```

On mobile (< 768px): The 240px sidebar takes 60%+ of the viewport, there's no hamburger menu, no collapsible navigation, and content is squeezed into <40% of the screen. The login/register pages use `px-4` and `max-w-sm` which work on mobile — but the authenticated layout is broken on small screens.

**Also absent:**
- No PWA manifest (`manifest.json`)
- No service worker
- No `viewport` meta tag for mobile scaling
- No touch-friendly tap targets (buttons are fine but sidebar links at 40px may be tight)

---

## 4. Webhook Event Coverage Analysis

### Registered Events: 26 Total

The handler registry in `apps/api/src/webhooks/webhooks.service.ts` maps 26 event types across 7 handlers:

| Handler | Events | Handling Quality |
|---------|--------|-----------------|
| **PaymentIntentHandler** | 5 events (`succeeded`, `payment_failed`, `canceled`, `processing`, `requires_action`) | ✅ All properly handled. Each case updates DB state with appropriate error codes. |
| **SetupIntentHandler** | 3 events (`succeeded`, `setup_failed`, `canceled`) | ✅ All handled. PM ID captured on success. |
| **SubscriptionHandler** | 6 events (`created`, `updated`, `deleted`, `trial_will_end`, `paused`, `resumed`) | ✅ All handled. `trial_will_end` syncs + logs a notification reminder (but no actual notification is sent). |
| **InvoiceHandler** | 5 events (`payment_succeeded`, `payment_failed`, `upcoming`, `created`, `finalized`) | ⚠️ 3/5 handled. `created` and `finalized` have no case in switch — silent no-op. |
| **PaymentMethodHandler** | 3 events (`attached`, `detached`, `updated`) | ✅ All handled. Upsert on attach/update, remove on detach. |
| **CustomerHandler** | 3 events (`created`, `updated`, `deleted`) | ✅ All handled. Sync from Stripe event data. |
| **MandateHandler** | 1 event (`updated`) | ✅ Handled. Re-syncs PM for mandate status changes. |

### What Happens on Unhandled Events?

In `WebhooksService.dispatch()`:
```typescript
const handler = this.handlerRegistry.get(event.type);
if (!handler) {
  this.logger.warn({ message: 'Unhandled webhook event type', eventType: event.type });
  return;  // ← returns void, marks record as "processed" in execute()
}
```

**Behavior:** Unhandled events are **silently acknowledged** (200 returned to Stripe), logged as a warning, and marked as "processed" in the DB. This is the correct behavior for webhook reliability (Stripe retries on non-200), but it means:

- **Data drift**: Events like `charge.refunded` will never update the local DB state. The payment intent stays "succeeded" even after a full refund.
- **No alerting**: There's no monitoring alert on unhandled events. The warning only appears in application logs.
- **The dispatch method does NOT re-throw**, so BullMQ will NOT retry unhandled events (they're intentionally treated as "acknowledged but not actionable").

### Critical Missing Webhook Events

These Stripe events are NOT in the handler registry and will be silently discarded:

| Missing Event | Business Impact |
|---------------|----------------|
| `charge.refunded` | Refunded payments show as "succeeded" forever |
| `charge.refund.updated` | Partial refund status not tracked |
| `charge.dispute.created` | No dispute awareness — critical for fraud operations |
| `charge.dispute.closed` | No dispute resolution tracking |
| `charge.dispute.funds_withdrawn` | Revenue impact invisible |
| `customer.discount.*` | Coupon/discount changes not synced |
| `invoice.paid` | Invoice payment outside subscription not tracked |
| `invoice.voided` | Voided invoices not updated |
| `payment_intent.amount_capturable` | Auth-and-capture flows not supported |
| `payment_intent.partially_funded` | Customer balance payments not tracked |
| `setup_intent.requires_action` | SCA challenges on setup not handled |

---

## 5. Admin / Reporting Capabilities

### What Exists (API Layer)

`apps/api/src/reporting/` contains a solid analytics foundation:

| Endpoint | Query | Business Value |
|----------|-------|---------------|
| `GET /reports/revenue/:year` | Monthly revenue by currency from succeeded PIs | Revenue trend analysis |
| `GET /reports/subscriptions/by-plan` | Active subscribers + MRR by plan | MRR reporting |
| `GET /reports/subscriptions/churn?months=6` | Canceled subscriptions per month | Churn analysis |
| `GET /reports/customers/:customerId/ltv` | Per-customer LTV (total spend, transaction count) | Customer value |
| `GET /reports/payments/failed-by-decline-code` | Failed payments grouped by decline code (last month) | Payment operations |
| `GET /reports/webhooks/health` | Webhook event counts + avg processing time by type (last 24h) | Operational health |
| `GET /reports/customers/cohort-ltv` | Cohort-based LTV (monthly cohorts) | Growth analytics |

All queries use Oracle-native SQL with proper window functions, NULL handling (`NVL`), and date math. Cached in Redis for 5 minutes.

### What's Missing (UI + Access Control)

1. **No admin dashboard UI** — zero frontend pages consume these endpoints. The sidebar has no "Reports" or "Analytics" navigation item.
2. **No role concept** — any authenticated user can call these endpoints. There's no `ROLE_ADMIN` or `ROLE_MERCHANT` distinction. A regular customer can see aggregate revenue across all customers.
3. **No export capability** — no CSV/PDF export endpoints.
4. **No date range filtering** — revenue is locked to `:year`, churn to `:months`. No custom date ranges.
5. **No real-time dashboard** — all data is cache-stale by up to 5 minutes (acceptable for analytics, but no WebSocket push for live dashboards).

---

## 6. Multi-Tenancy Analysis

### Current Architecture: Single-Tenant Only

The app assumes a single Stripe account (one `STRIPE_SECRET_KEY` in config). There is no concept of:
- **Organizations / Merchants**: No `organizations` table, no `organization_id` FK
- **Multiple Stripe accounts**: One `StripeService` instance, one API key
- **Per-merchant webhook endpoints**: Single webhook URL receives all events
- **Per-merchant pricing/plans**: One set of `SUBSCRIPTION_PLANS`

### What Would Be Needed for Multi-Merchant Scale

| Layer | Changes Required | Effort |
|-------|-----------------|--------|
| **Database** | Add `organizations` table, `organization_id` FK to all entities. Per-org Stripe credentials (encrypted). | Large migration |
| **Auth** | Add organization context to JWT. Middleware to resolve current org from subdomain or header. | Auth service refactor |
| **Stripe** | Dynamic `Stripe` client instantiation per org. Connection pooling for ~100+ Stripe instances. | Stripe service major refactor |
| **Webhooks** | Per-org webhook secret verification. Route events by `account` field or dedicated per-org endpoints. | Webhook guard refactor |
| **Rate Limiting** | Per-org throttling (not just global per-IP). | Throttler storage change |
| **Reporting** | All aggregate queries need `WHERE organization_id = :orgId`. | SQL changes in all 7 query methods |
| **Frontend** | Org switcher in sidebar. Org-scoped data fetching. | New components |
| **Billing** | Per-org Billing Portal configuration (different Stripe account = different portal). | Config per org |

**Verdict:** This app is 4-6 weeks of engineering away from even basic multi-tenancy, and 3-4 months from production-grade multi-merchant support.

---

## 7. Mobile Readiness

### Current State

| Factor | Status | Detail |
|--------|--------|--------|
| Responsive layout | ❌ None | Zero responsive breakpoints in `globals.css`. Fixed 240px sidebar + `ml-60` offset. |
| Mobile navigation | ❌ None | No hamburger menu, no collapsible sidebar, no bottom nav. |
| Touch targets | ⚠️ Partial | Buttons at 36-40px height are adequate. Sidebar links at 40px may be tight. |
| PWA | ❌ None | No manifest, no service worker, no offline support. |
| Auth pages | ✅ Works | Login/register use `px-4`, `max-w-sm`, `min-h-screen` — properly centered on mobile. |
| Checkout flow | ⚠️ Partial | The Stripe Payment Element is responsive by default, but the amount entry form and two-step container may overflow on small screens. |
| Data tables | ❌ Broken | `PaymentsPage` uses a full `<table>` with 5 columns — will overflow on mobile with no horizontal scroll or card-based fallback. |

---

## 8. Error Handling Assessment

### What's Good

- **Frontend error recovery**: The payment-methods page distinguishes between recoverable and non-recoverable errors and offers "Try again" for retryable scenarios.
- **Webhook idempotency**: Deduplication by Stripe event ID; already-processed events are skipped without enqueuing.
- **BullMQ retries**: 3 attempts with exponential backoff for webhook processing failures.
- **Stripe SDK retries**: `maxNetworkRetries: 2` for connection errors and 5xx.
- **Global exception filter**: `apps/api/src/common/filters/all-exceptions.filter.ts` ensures consistent error responses.
- **Stripe-specific exception filter**: `apps/api/src/common/filters/stripe-exception.filter.ts` handles Stripe API errors.
- **Server-side payment verification**: The checkout success page calls `verifyPaymentIntent()` server-side, not just trusting URL params.

### What's Missing

- **Redis failure cascade**: No circuit breaker — Redis blip = HTTP 500 on multiple endpoints.
- **No Sentry/error tracking**: No `@sentry/nestjs` or `@sentry/nextjs` integration for production error monitoring.
- **No client-side error boundary**: The frontend has per-page `error.tsx` files (Next.js error boundaries) for checkout, payment-methods, subscriptions — but no global error boundary component.
- **No graceful degradation**: If the API is down, the frontend shows a raw error message rather than a cached/courtesy view.

---

## 9. DEMO_CUSTOMER_ID Status: FIXED

The `CODE_QUALITY_REPORT.md` and `DEPLOYMENT_READINESS.md` both identify `NEXT_PUBLIC_DEMO_CUSTOMER_ID` as a P0 blocker in `apps/web/src/app/payment-methods/page.tsx`. However, **this has been resolved**. Two independent grep searches across the entire codebase found zero instances of `DEMO_CUSTOMER` or `NEXT_PUBLIC_DEMO`. The payment-methods page now correctly derives the customer ID from `useMyCustomer()`:

```typescript
const { data: myCustomer } = useMyCustomer();
const customerId = myCustomer?.id ?? '';
```

This is the correct user→customer derivation pattern. The documentation is outdated.

---

## Prioritized Feature Roadmap

### P0 — Critical (Ship Blocker)

| # | Feature | Rationale | Effort |
|---|---------|-----------|--------|
| P0-1 | **Refresh token + session management** | Users cannot use the app for more than 15 minutes. Silent session loss breaks all SPA interactions. | 3-5 days |
| P0-2 | **Redis circuit breaker** | Production readiness: Redis failure = cascade 500s on customer, plans, and reporting endpoints. Fix: try/catch with DB fallback. | 1 day |
| P0-3 | **Refund capability** | Most common post-payment operation. Without it, customer service has no tooling. Requires: Refund entity, controller, webhook handlers, frontend UI. | 5-7 days |
| P0-4 | **Invoice visibility for end users** | Subscription customers need to see billing history. Mitigated partially by Billing Portal redirect — but in-app is table stakes. | 3-5 days |
| P0-5 | **Admin role + report access control** | Currently any authenticated user can see aggregate revenue, churn, cohort data. Must restrict reporting endpoints to admin role. | 2-3 days |

### P1 — High Priority (First Sprint Post-Launch)

| # | Feature | Rationale | Effort |
|---|---------|-----------|--------|
| P1-1 | **Admin dashboard UI** | The 7 reporting endpoints have no UI. Build `/admin/reports` with revenue charts, MRR trend, churn rate, and webhook health. | 5-7 days |
| P1-2 | **Dispute webhook handling + UI** | `charge.dispute.*` events are silently discarded. Add handlers + dispute list in admin dashboard. | 3-5 days |
| P1-3 | **Frontend component tests** | Zero coverage on `CheckoutForm`, `SetupForm`, `AmountEntryForm`, `Sidebar`, all pages. Critical for payment UX reliability. | 5-7 days |
| P1-4 | **Responsive design** | Mobile users cannot use the authenticated layout. Add hamburger menu, collapsible sidebar, responsive breakpoints, mobile data table alternatives. | 5-7 days |
| P1-5 | **Fix invoice.created / invoice.finalized silent no-ops** | Either implement handling or remove from registry. Currently wasted compute + misleading. | 0.5 day |
| P1-6 | **Fix user→customer ownership FK** | Add `USER_ID` column + FK to `STRIPE_CUSTOMERS`. Enforce ownership in all controllers (some already do, others don't). | 2-3 days |
| P1-7 | **Sentry error tracking** | `@sentry/nestjs` + `@sentry/nextjs` for production error visibility. | 1-2 days |
| P1-8 | **DB transaction wrapping for Stripe + DB writes** | Current pattern: Stripe API call → DB insert. If DB insert fails, Stripe resource is orphaned. Fix with transactions + idempotency. | 2-3 days |

### P2 — Medium Priority (Second Sprint)

| # | Feature | Rationale | Effort |
|---|---------|-----------|--------|
| P2-1 | **PWA support** | Manifest, service worker, offline caching for returning users. | 3-5 days |
| P2-2 | **Payment method detach warnings** | Warn when detaching a default PM or a PM linked to active subscriptions. | 1-2 days |
| P2-3 | **Date range filtering on reports** | Current reports are fixed to year/month. Add `?from= &to=` params. | 2-3 days |
| P2-4 | **Report export (CSV/PDF)** | Download buttons on report endpoints. | 2-3 days |
| P2-5 | **Prometheus metrics endpoint** | `@willsoto/nestjs-prometheus` for request rates, error rates, DB pool saturation. | 1-2 days |
| P2-6 | **CI/CD pipeline** | Automated lint, build, test on pull requests. Currently no CI. | 2-3 days |
| P2-7 | **Stripe Connect foundation** | Basic multi-merchant data model (organizations table + FK). Lays groundwork without full Connect integration. | 3-5 days |
| P2-8 | **Email notifications** | `trial_will_end` handler logs "consider sending notification" — but never actually sends one. Integrate Resend/SendGrid. | 3-5 days |

### P3 — Backlog

| # | Feature | Rationale |
|---|---------|-----------|
| P3-1 | Full Stripe Connect multi-merchant | 3-4 months of engineering as outlined in Section 6 |
| P3-2 | Product catalog browsing UI | Browse Stripe Products + Prices in-app |
| P3-3 | PostgreSQL migration from Oracle XE | XE is free but limited (2 CPU, 2GB RAM, 12GB data). Not production-scalable. |
| P3-4 | Argon2id password hashing | OWASP-recommended over bcrypt for new projects |
| P3-5 | Webhook event archival/partitioning | `STRIPE_WEBHOOK_EVENTS` grows unbounded |
| P3-6 | Nonce-based CSP (remove unsafe-inline) | Required for PCI SAQ A+ compliance |
| P3-7 | Multi-region deployment | For non-US Stripe merchants and latency requirements |

---

## Summary of Critical Findings

1. **The app is a solid Stripe integration starter** — core payment flows, subscription management, and payment method handling work correctly and handle error states well.

2. **Three P0 blockers prevent production use**: no refresh tokens (15-min session death), Redis failure cascade (no circuit breaker), and missing refund/invoice user-facing features.

3. **The "DEMO_CUSTOMER_ID hardcoded" issue is FIXED** — the payment-methods page now correctly uses `useMyCustomer()`. Documentation should be updated.

4. **Webhook coverage is 80% functional** — 26 events handled, but critical refund/dispute events are missing, and 2 registered events are silent no-ops.

5. **The reporting API is surprisingly robust** — 7 well-designed analytics queries with Redis caching. But zero frontend UI and no access control means this capability is invisible and insecure.

6. **Mobile is completely broken** — fixed sidebar layout with zero responsive breakpoints. The auth pages work on mobile, but the authenticated experience does not.

7. **11 tests exist** (7 API + 4 E2E), **zero frontend component tests**. This is better than the "no tests" claim in existing docs, but still critically low for a payment application.

8. **Multi-tenancy is a from-scratch effort** — 4-6 weeks minimum for basic multi-merchant support, 3-4 months for production-grade.
