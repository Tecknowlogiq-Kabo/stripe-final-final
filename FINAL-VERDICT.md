# FINAL VERDICT — Stripe Integration App

**Date:** 2026-05-19
**Arbiter:** Cross-Team Synthesis — Systems, Governance, Product, Code Quality
**Reports Reviewed:** 8 (4 analyses + 4 rebuttals, 140+ pages of findings)
**Verdict Status:** FINAL. No further debate.

---

## 1. THE VERDICT

# ❌ NOT READY FOR PRODUCTION

**Confidence: 92%**

This application has strong engineering foundations — clean NestJS patterns, correct webhook HMAC verification, solid Stripe Elements integration, and effective idempotency key infrastructure. However, **five critical gaps make it unsafe for real users and real money:**

| # | Blocker | If not fixed, what happens |
|---|---------|---------------------------|
| 1 | Redis throttler path has no error handling | Redis blip → 500 on every request including webhooks → Stripe disables webhook endpoint → state sync dies permanently |
| 2 | Stripe API + DB write is not atomic | DB insert fails after Stripe succeeds → orphaned Stripe resource → potential double-charge → chargeback → Stripe account at risk |
| 3 | `customer.deleted` webhook handler is a dead write | Deleted customers stay `IS_DELETED = 0` forever → app displays deleted customers as active → trust violation |
| 4 | No metrics, alerting, or error tracking | All failures are silent — you discover them via customer complaints or Stripe account warnings |
| 5 | Reporting endpoints have zero authorization | Any registered user can query aggregate revenue, MRR, churn, and any customer's lifetime value |

**Estimated time to production readiness:** 2 weeks (10 working days) of focused remediation following the Critical Path below.

---

## 2. CONSENSUS TOP 5 — Issues All Four Teams Agree Are Critical

### 🥇 CRITICAL #1: Redis Throttler Storage Has No Failure Resilience

**Files:** `apps/api/src/redis/redis.service.ts:82-100`, `apps/api/src/redis/redis-throttler.storage.ts:14-54`, `apps/api/src/webhooks/webhooks.controller.ts:13-14`

**What it is:** `incr()`, `ttl()`, `expire()`, and `setWithExpiry()` in `redis.service.ts` have zero try/catch. `RedisThrottlerStorage.increment()` calls all four on every HTTP request. If Redis becomes unreachable, every request — including Stripe webhooks — returns HTTP 500.

**The cascade:** Redis down → ThrottlerGuard throws on every route → 500 cascade → Stripe webhook endpoint returns 500 → Stripe retries for 3 days → Stripe disables webhook endpoint → **all state synchronization stops permanently.**

**The lying comment:** `webhooks.controller.ts:13` claims "The global ThrottlerGuard is bypassed here because WebhookSignatureGuard runs first." This is **factually false**. NestJS runs ALL `APP_GUARD` guards on all routes. The webhook controller has no `@SkipThrottle()`. The comment is dangerously misleading.

**Fix:**
1. Wrap `RedisThrottlerStorage.increment()` in try/catch with fail-open fallback (return `{ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }`)
2. Add `@SkipThrottle()` decorator to `WebhooksController` class
3. Delete the lying comment
4. **Total effort: 30 minutes**

**All team agreement:**
- Governance C-1 (CRITICAL): "Redis down = 100% request failure"
- Systems Rebuttal A-1: "It's worse than the governance report says — BullMQ uses the same Redis"
- Code Rebuttal A+A #1: "The throttler path is the ONLY code path that hits those four methods"
- Product Rebuttal 1.2: "Combined product impact: complete service outage from a single Redis container restart"

---

### 🥈 CRITICAL #2: Stripe API + DB Write — No Atomicity, Risk of Double-Charges

**Files:** `apps/api/src/payment-intents/payment-intents.service.ts:88-97`, `apps/api/src/setup-intents/setup-intents.service.ts:57-72`, `apps/api/src/subscriptions/subscriptions.service.ts:52-84`

**What it is:** Every "create" follows the pattern: (1) Call Stripe API → irreversible resource creation, (2) INSERT into local DB → can fail. If step 2 fails, the Stripe resource exists but the app has no record. The user sees an error, retries, and may be double-charged.

**Inconsistency across services:**

| Service | Try/catch on DB insert? | `withTransaction()`? | Stripe cleanup on failure? |
|---------|------------------------|---------------------|---------------------------|
| `CustomersService` | ✅ Yes | ✅ Yes | ✅ `stripe.customers.del()` |
| `SubscriptionsService` | ✅ Yes | ✅ Yes | ✅ `stripe.subscriptions.cancel()` |
| `PaymentIntentsService` | ❌ No | ❌ No | ❌ Orphaned PI |
| `SetupIntentsService` | ❌ No | ❌ No | ❌ Orphaned SI |

The good pattern already exists in Customers and Subscriptions — it was never replicated to PaymentIntents and SetupIntents, which handle **real money.**

**The double-charge scenario (Product Rebuttal 1.1):**
1. User clicks "Subscribe — $99/month"
2. Stripe creates subscription. **Money moves.**
3. DB insert fails (connection pool, deadlock).
4. App returns "Something went wrong."
5. User thinks it failed. Clicks "Subscribe" again.
6. New idempotency key → **second subscription. $198/month.**
7. Next month: two charges on credit card → chargeback → Stripe account at risk.

**Fix:**
1. Wrap `PaymentIntentsRepository.insert()` in `withTransaction()`
2. Wrap `SetupIntentsRepository.insert()` in `withTransaction()`
3. Add try/catch with Stripe cleanup in `PaymentIntentsService.create()` and `SetupIntentsService.create()` (mirror Subscription/Customer patterns)
4. Move the success log in `PaymentIntentsService.create()` from BEFORE `repo.insert()` to AFTER
5. **Total effort: 2 hours**

**All team agreement:**
- Governance H-2 (HIGH): "Cleanup pattern is best-effort, not transactional"
- Systems Risk #1 (CRITICAL): "#1 architectural risk — orphaned Stripe resources accumulate"
- Code Review Fix #2 (P0): "Payment intents and setup intents are strictly worse than customers"
- Product Rebuttal 1.1 (CRITICAL): "This is a revenue integrity failure with existential business consequences"

---

### 🥉 CRITICAL #3: `customer.deleted` Webhook Dead Write

**File:** `apps/api/src/webhooks/handlers/customer.handler.ts:44-55`

**What it is:** The handler sets `localCustomer.isDeleted = true` on an in-memory variable but **never persists it to the database.** The comment says "using internal method directly since this is a sync operation" — but the method call is **missing.** Comment-driven development.

**Downstream blast radius:** Every repository query filters `WHERE IS_DELETED = 0`:
- `customers.repository.ts:30` — `findActiveByEmail`
- `customers.repository.ts:39` — `findById`
- `customers.repository.ts:47` — `findByUserId`
- `customers.repository.ts:55` — `findByStripeId`

Deleted customers remain visible in ALL queries forever. The app displays them as active. The log says "Customer deleted in Stripe, marking locally" — which is a **lie.**

**Fix:** Replace `localCustomer.isDeleted = true;` with `await this.customersService.repo.softDelete(localCustomer.id);` — call the repository method directly to avoid re-calling `stripe.customers.del()` on an already-deleted Stripe customer (which would throw a 404 and fail silently).

**Total effort: 15 minutes**

**All team agreement:**
- Governance C-2 (CRITICAL): "Dead write — in-memory only, never persisted"
- Systems 11.2: "Customer is marked as deleted in memory only"
- Code Rebuttal A+A #2: "The customer remains visible in all queries forever"
- Product Rebuttal 1.3: "Trust violation. App displays wrong data. Support can't help."

---

### 🏅 CRITICAL #4: Zero Observability — Silent Failures

**Files:** `apps/api/src/main.ts:15-18`, all service files, no metrics/alerting config

**What it is:** Three compounding gaps:
1. **No Prometheus metrics** — Can't observe request rate, error rate, latency, DB pool, BullMQ depth
2. **No Sentry/error tracking** — Unhandled exceptions are logged locally to stdout and lost on container restart
3. **`process.exit(1)` on unhandledRejection** — A single unhandled promise rejection **kills the entire API process** with no graceful shutdown, no draining, no alert

**The `process.exit(1)` is the worst single line of code in the app:**
```typescript
// apps/api/src/main.ts:15-18
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
  process.exit(1);  // ← Instant kill. No app.close(). No draining. No alert.
});
```

Any developer who adds a `Promise.reject()` without `.catch()` anywhere in the codebase takes down the entire API. This is a self-inflicted DoS vector.

**Fix:**
1. Replace `process.exit(1)` with `app.close().then(() => process.exit(1))`
2. Add `@nestjs/prometheus` or `prom-client` with `/metrics` endpoint
3. Export at minimum: request duration histogram, error counter by status code, DB pool metrics
4. Add Sentry (`@sentry/nestjs` + `@sentry/nextjs`)
5. Configure Grafana dashboard + alerts (5xx rate > 1%, webhook failure > 5%, DB pool > 80%)
6. **Total effort: 2 days**

**All team agreement:**
- Systems Risk #4 (MEDIUM — but Systems Rebuttal says "should be Risk #2 or #3"): "Flying blind in production"
- Governance Blind Spot (CRITICAL): "No audit trail — compliance blocker"
- Product Rebuttal 1.6 (CRITICAL): "Makes every OTHER finding 10x more dangerous"
- Code Rebuttal A+A #5: "A single unhandled promise rejection kills the entire API process"

---

### 🏅 CRITICAL #5: Reporting Endpoints — Zero Authorization

**Files:** `apps/api/src/reporting/reporting.controller.ts`

**What it is:** All 7 reporting endpoints have zero authorization beyond the global JWT guard. Any authenticated user can query:
- `GET /reports/revenue/:year` — Aggregate revenue across ALL customers
- `GET /reports/subscriptions/by-plan` — MRR by plan
- `GET /reports/subscriptions/churn` — Churn rate
- `GET /reports/customers/:customerId/ltv` — Any customer's lifetime value (no ownership check)
- `GET /reports/customers/cohort-ltv` — Cohort analytics
- `GET /reports/payments/failed-by-decline-code` — Payment failure patterns
- `GET /reports/webhooks/health` — Webhook operational data

The LTV endpoint is the worst: it accepts any customer UUID with `ParseUUIDPipe` validation but performs **no ownership check.** Any user can query any customer's financial data.

**Competitive intelligence exposure (Product Rebuttal 1.5):** A competitor enumerates customer IDs → calls LTV endpoint for each → knows your customer count, highest-value customers, revenue → targets them for poaching.

**The code review incorrectly marked this as "FIXED":** The `CODE_QUALITY_REPORT.md` P1-6 was marked fixed because a class-level `@Throttle({ default: { limit: 10, ttl: 60_000 } })` was added. Rate limiting is NOT authorization. It limits *how fast* data can be exfiltrated, not *whether* it can be accessed.

**Fix:**
1. Add `@CurrentUser() user: JwtUser` to `getCustomerLtv()` + ownership check: `customer.userId === user.id`
2. Restrict all aggregate endpoints to admin role (add `role` column to `APP_USERS`, create `RolesGuard`)
3. Add audit logging for all report access
4. **Total effort: 2 hours**

**All team agreement:**
- Governance H-1 (HIGH): "Direct horizontal privilege escalation"
- Product G7 (CRITICAL): "Any authenticated user can call these endpoints and see aggregate revenue"
- Systems Rebuttal BS-6: "The code review conflated rate limiting with authorization"
- Code Rebuttal A+A #3: "All 6 other reporting endpoints have the same problem"

---

## 3. DISPUTED FINDINGS — RULINGS

### Dispute 1: Do refresh tokens exist?

| Team | Claim | Reality |
|------|-------|---------|
| **Product Analysis** (G3, P0-3) | "No refresh tokens. No `POST /auth/refresh`. No recovery path." | ❌ **FLAT WRONG** |
| **Governance** (H-4) | "Frontend has no proactive refresh... interceptor never called" | ⚠️ **PARTIALLY WRONG** |
| **Systems** (Correction to CODE_QUALITY) | "This has been fixed" | ✅ **CORRECT** |
| **Code Rebuttal** (Disagree #1) | "THIS IS COMPLETELY FALSE" — verified 5 source files | ✅ **CORRECT** |

**🔨 RULING: The Product Analysis is factually wrong. Refresh tokens exist and work.**

**Verified evidence from source code:**
1. `apps/api/src/auth/token.service.ts` — `issueTokenPair()`, `validateRefreshToken()`, `revokeRefreshToken()` — full implementation with 7-day TTL and rotation
2. `apps/api/src/auth/auth.service.ts:36-50` — `AuthService.refresh()` with full rotation (revoke old → issue new)
3. `apps/api/src/auth/auth.controller.ts:76-86` — `POST /auth/refresh` endpoint
4. `apps/web/src/lib/api-client.ts:57-78` — Silent 401 → `POST /auth/refresh` → retry interceptor
5. `apps/api/src/auth/auth.controller.ts:23-27` — Cookies set with correct lifetimes (15m + 7d)

**The real issue (not the one claimed):**
- The middleware (`middleware.ts`) only checks cookie presence, not JWT validity — but the cookie maxAge matches the JWT expiry, so they expire simultaneously. No gap.
- Governance M-2: If Redis is down during login, `TokenService.issueTokenPair()` silently returns a refresh token that will NEVER validate — user discovers this 15 minutes later.
- The `access_token` cookie maxAge (15 min) = JWT expiry (15 min). The cookie disappears exactly when the JWT expires. The middleware correctly redirects. The api-client interceptor handles the window where the JWT is valid but about to expire.

**Actual severity: HIGH (not CRITICAL).** The system works for normal operation. It fails silently when Redis is down during login (M-2). The JWT lifetime is aggressive but not broken.

**Product Analysis score correction: Auth & Session should be 7/10, not 4/10.**

---

### Dispute 2: CSP `unsafe-inline` severity

| Team | Claim | Severity |
|------|-------|----------|
| **Governance** (H-3) | "Elevated to HIGH — material for PCI compliance" | HIGH |
| **Product** (P2-3) | "Add Trusted Types header as quick win. Full hardening is backlog." | MEDIUM |
| **Systems Rebuttal** (D-5) | "Wrong reasoning, right conclusion. Severity downgrade to MEDIUM." | MEDIUM |

**🔨 RULING: MEDIUM severity. Add Trusted Types header now. Full CSP hardening in backlog.**

**Reasoning:**
1. Governance's PCI DSS 4.0 6.4.3 reasoning is shaky — that requirement is about third-party script sources, not inline scripts. Stripe.js is loaded via an external URL already in the CSP.
2. React JSX auto-escaping + httpOnly cookies provide substantial XSS mitigation.
3. Next.js App Router REQUIRES `unsafe-inline` for chunk loading — this isn't laziness, it's a framework constraint.
4. The compensating control (`Trusted Types` header: `require-trusted-types-for 'script'`) blocks DOM XSS sinks regardless of CSP script-src policy and takes 5 minutes to add.

**Fix (5 minutes):** Add to `next.config.mjs` headers:
```
'Trusted-Types, require-trusted-types-for \'script\''
```

---

### Dispute 3: Multi-provider abstraction priority

| Team | Claim | Priority |
|------|-------|----------|
| **Systems** (Risk #5) | "No multi-provider abstraction... tightly coupled to Stripe" | Top-5 Risk |
| **Product** (P3-1) | "3-4 months of engineering... backlog" | P3 Backlog |

**🔨 RULING: BACKLOG. Not a production concern. Revisit in 12 months.**

**Reasoning:**
- Zero users. Zero revenue. Building a provider abstraction before product-market fit is premature optimization.
- Stripe has 65%+ SaaS payment market share. The Venn diagram of "needs multi-provider" and "running single NestJS API on Docker Compose with Oracle XE" has approximately zero overlap.
- Systems team acknowledges: "Is this a problem today? No." Then it shouldn't be a Top-5 risk.
- The architectural cost of getting the abstraction wrong (wrong interface, wrong assumptions) is higher than refactoring later when needed.

**Risk register entry:** "Single-provider dependency on Stripe — accepted business risk with 12-month review horizon."

---

### Dispute 4: Missing FK severity

| Team | Claim | Severity |
|------|-------|----------|
| **Governance** (C-3) | "Migration 005 created index but no FK — comment is misleading" | CRITICAL |
| **Product** (2.6) | "Exposure limited to manual DB ops or Stripe price archival" | MEDIUM |

**🔨 RULING: HIGH. Fix in next migration. Not a ship-blocker.**

**Reasoning:**
- Plans are synced from Stripe, not user-created/deleted. The only way a plan gets deleted is manual DB ops or Stripe price archival (unlikely for prices with active subscriptions).
- Active subscriptions referencing a deleted plan show NULL plan data in join queries — bad but limited blast radius.
- The fix is a one-line migration.

**Fix:**
```sql
ALTER TABLE STRIPE_SUBSCRIPTIONS
  ADD CONSTRAINT FK_SUB_PRICE_ID
  FOREIGN KEY (STRIPE_PRICE_ID) REFERENCES SUBSCRIPTION_PLANS(STRIPE_PRICE_ID)
  ON DELETE RESTRICT;
```

**Governance score correction:** C-3 severity downgraded from CRITICAL to HIGH. Not a production blocker.

---

### Dispute 5: Shared-types dead code severity

| Team | Claim | Severity |
|------|-------|----------|
| **Code Review** (Fix #1) | "Top 10 Most Impactful Fix — #1 P0" | P0 |
| **Systems Rebuttal** (D-4) | "Dead code is NEVER a P0. P2 at worst." | P2 |
| **Product** (2.3) | "No user's payment ever failed because of an unused npm package" | P3 |

**🔨 RULING: P3. Delete the package in a quiet afternoon. Not a production concern.**

**Reasoning:**
- P0 means "production outage, data corruption, or security bypass." An unused package is none of these.
- Severity inflation dilutes the P0 label. If everything is P0, nothing is P0.
- The code review's own scoring framework should have caught this: "Naming and Consistency: 7/10" — this is a consistency issue.

---

### Dispute 6: Code duplication and `AsyncLocalStorage` priority

| Team | Claim | Severity |
|------|-------|----------|
| **Code Review** (Fix #3, #6, #7) | "Duplicated code... missing AsyncLocalStorage" | P1/P2 |
| **Product** (2.4) | "Code quality concerns masquerading as product issues" | LOW |

**🔨 RULING: LOW. Developer experience improvements for a later sprint.**

**Reasoning:**
- The hierarchy is: User pain > Developer pain. Fix the things that hurt users first.
- Duplicated `formatDate()`, `getPaymentMethodLabel()`, and `getAuthHeader()` are real DRY violations but have zero user-facing impact.
- `AsyncLocalStorage` for correlation IDs is nice-to-have for debugging — it's not a production blocker.

---

### Dispute 7: Error/loading page color scheme

| Team | Claim | Severity |
|------|-------|----------|
| **Code Review** (Fix #8) | "Uses gray-900/gray-200 on dark theme — visual clash" | P2 |
| **Product Rebuttal** (3.1) | "This is a trust signal failure. 48% of users cite 'site looked untrustworthy' as abandonment reason." | P1 |

**🔨 RULING: P1. Visual trust on payment pages directly impacts conversion.**

**Reasoning:**
- Research confirms visual polish is directly correlated with perceived trustworthiness on payment pages.
- This manifests on EVERY error state — every failed payment, every expired session.
- The fix is trivial: swap `text-gray-900` → `text-zinc-100`, `bg-gray-200` → `bg-zinc-800`, `bg-gray-100` → `bg-zinc-700`.

**Fix: 10 minutes. Do it.**

---

### Dispute 8: Per-IP rate limiting severity

| Team | Claim | Severity |
|------|-------|----------|
| **Governance** (M-1) | "Per-IP rate limiting — shared IPs share limits" | MEDIUM |
| **Product** (2.5) | "Actively hostile to B2B/team customers" | HIGH |

**🔨 RULING: HIGH. Fix in Phase 3 (Day 6).**

**Reasoning:**
- In any office/corporate deployment behind NAT, 50 users share one IP → 2 req/min per user.
- The auth throttle (5 req/min per IP) ÷ 50 users = one person logging in blocks everyone else.
- For a B2B SaaS product, this makes the app **unusable for the very customers you want** (teams, businesses).
- The fix (per-user key generation with IP fallback) is straightforward and the Governance team's solution is correct.

---

## 4. CRITICAL PATH TO PRODUCTION — 10-Day Sprint Plan

### Phase 1: Stop the Bleeding (Days 1-2)

| Day | # | Action | Effort | Files |
|-----|---|--------|--------|-------|
| **1** | 1 | **Wrap throttler storage in try/catch with fail-open** — Prevents 100% HTTP 500 cascade on Redis failure | 30 min | `redis-throttler.storage.ts`, `redis.service.ts` |
| **1** | 2 | **Add `@SkipThrottle()` to webhook controller + fix lying comment** — Prevents Stripe webhook endpoint disable | 5 min | `webhooks.controller.ts` |
| **1** | 3 | **Fix `customer.deleted` dead write** — Replace `localCustomer.isDeleted = true` with `repo.softDelete(id)` | 15 min | `customer.handler.ts` |
| **1** | 4 | **Add try/catch + Stripe cleanup to PaymentIntentsService.create()** — Mirror Customers/Subscriptions pattern | 45 min | `payment-intents.service.ts`, `payment-intents.repository.ts` |
| **1** | 5 | **Add try/catch + Stripe cleanup to SetupIntentsService.create()** — Mirror Customers/Subscriptions pattern | 45 min | `setup-intents.service.ts`, `setup-intents.repository.ts` |
| **1** | 6 | **Move `PaymentIntentsService.create()` success log AFTER `repo.insert()`** — Don't log success before it happens | 5 min | `payment-intents.service.ts` |
| **2** | 7 | **Add `withTransaction()` to PaymentIntentsRepository.insert()** — Match pattern in CustomersRepository | 15 min | `payment-intents.repository.ts` |
| **2** | 8 | **Add `withTransaction()` to SetupIntentsRepository.insert()** — Match pattern in CustomersRepository | 15 min | `setup-intents.repository.ts` |
| **2** | 9 | **Replace `process.exit(1)` with graceful shutdown** — `app.close().then(() => process.exit(1))` | 15 min | `main.ts` |
| **2** | 10 | **Fix error/loading page color scheme** — Swap to zinc-* dark tokens | 10 min | `error.tsx`, `loading.tsx` |

**End of Day 2 milestone: App no longer crashes on Redis blip. Webhooks protected. No more orphaned Stripe resources. No more dead writes. No more self-inflicted process death.**

---

### Phase 2: Lock Down the Perimeter (Days 3-5)

| Day | # | Action | Effort | Files |
|-----|---|--------|--------|-------|
| **3** | 11 | **Add ownership check to `GET /reports/customers/:customerId/ltv`** — Verify `customer.userId === user.id` | 30 min | `reporting.controller.ts` |
| **3** | 12 | **Add `role` column to APP_USERS + RolesGuard** — Admin/User distinction | 2 hours | `users.entity.ts`, migration, `roles.guard.ts` |
| **3** | 13 | **Restrict ALL aggregate reporting endpoints to admin role** — Revenue, MRR, churn, cohort, failed payments | 30 min | `reporting.controller.ts` |
| **4** | 14 | **Add Prometheus metrics endpoint** — `@nestjs/prometheus` or `prom-client` | 3 hours | new `metrics/` module |
| **4** | 15 | **Add Sentry error tracking** — `@sentry/nestjs` + `@sentry/nextjs` | 2 hours | `main.ts`, `instrumentation.ts`, `sentry.client.config.ts` |
| **5** | 16 | **Add Grafana dashboard + alerting config** — P95 latency, 5xx rate, DB pool, webhook failures | 2 hours | New `grafana/` config |
| **5** | 17 | **Make `TokenService.issueTokenPair()` throw on Redis failure** — Don't silently return unvalidatable refresh tokens | 10 min | `token.service.ts` |
| **5** | 18 | **Add `@Throttle({ payment: { limit: 20, ttl: 60_000 } })` to PaymentMethods setDefault/detach** | 5 min | `payment-methods.controller.ts` |

**End of Day 5 milestone: Authorization enforced. Metrics and alerting operational. Silent token failures eliminated. Payment methods rate-limited.**

---

### Phase 3: Harden and Validate (Days 6-8)

| Day | # | Action | Effort | Files |
|-----|---|--------|--------|-------|
| **6** | 19 | **Add FK_SUB_PRICE_ID constraint** — Backfill missing plan data, create FK with ON DELETE RESTRICT | 1 hour | New migration |
| **6** | 20 | **Add per-user rate limit key generation** — Prefer user ID over IP for authenticated requests | 1.5 hours | `app.module.ts` |
| **6** | 21 | **Add Trusted Types header to Next.js CSP** — `require-trusted-types-for 'script'` | 5 min | `next.config.mjs` |
| **7** | 22 | **Add Redis AOF persistence + volume** — `appendonly yes` + volume mount for `appendonly.aof` | 30 min | `docker-compose.yml` |
| **7** | 23 | **Fix invoice.created / invoice.finalized silent no-ops** — Either handle or remove from handler registry | 30 min | `invoice.handler.ts`, `webhooks.service.ts` |
| **7** | 24 | **Add `@Throttle({ auth: { limit: 10, ttl: 60_000 } })` to POST /auth/refresh** — Prevent unthrottled refresh attack | 5 min | `auth.controller.ts` |
| **8** | 25 | **Fix `clearCookie()` in logout** — Add `sameSite` and `secure` attributes matching original Set-Cookie | 5 min | `auth.controller.ts` |
| **8** | 26 | **Add webhook replay protection** — Explicit tolerance config for timestamp validation | 30 min | `webhook-signature.guard.ts` |
| **8** | 27 | **Delete shared-types dead package** — Or implement it properly | 15 min | `packages/shared-types/` |

**End of Day 8 milestone: Data integrity hardened. Rate limiting fair. Cookies consistent. Dead code removed.**

---

### Phase 4: Pre-Launch Verification (Days 9-10)

| Day | # | Action | Effort |
|-----|---|--------|--------|
| **9** | 28 | **Integration test: customer.deleted webhook → DB IS_DELETED = 1** | 1 hour |
| **9** | 29 | **Integration test: Redis outage → throttler fail-open → requests succeed** | 1 hour |
| **9** | 30 | **Integration test: Stripe API success + DB insert failure → cleanup succeeds** | 1 hour |
| **9** | 31 | **End-to-end test: Register → Add PM → Subscribe → Cancel** | 2 hours |
| **10** | 32 | **Stripe webhook test mode: Send all 26 event types → verify all processed** | 2 hours |
| **10** | 33 | **Load test: 100 concurrent checkouts → verify no double-charges, no 500s** | 2 hours |
| **10** | 34 | **Production Docker Compose override** — Production targets, restart policies, resource limits, no source mounts | 2 hours |

**End of Day 10 milestone: VERIFIED production ready. Launch.**

---

## 5. RISK THERMOMETER — Top 10 Risks

```
Impact
  ^
  │  💥 R2        💥 R1
  │  (Redis        (Stripe+DB
  │   cascade)      atomicity)
  │
  │  💥 R3         💥 R4
  │  (cust.deleted  (Zero obs/
  │   dead write)    alerting)
  │
  │  💥 R7         💥 R5        💥 R6
  │  (Single Redis  (Reporting   (No DLQ for
  │   for 3 uses)    no auth)     webhooks)
  │
  ├─────────────────────────────────────────→ Likelihood
  │  💥 R9         💥 R8        💥 R10
  │  (PG migration  (Oracle XE   (JWT secret
  │   path)          12GB cap)    no rotation)
  │
  │  LOW           MEDIUM       HIGH
```

| # | Risk | Likelihood | Impact | Pre-Fix | Post-Fix |
|---|------|-----------|--------|---------|----------|
| **R1** | Stripe+DB write not atomic → orphaned resources, double-charges | MEDIUM | CRITICAL | 🔴 | 🟢 (Day 1) |
| **R2** | Redis throttler crash → 500 on every request incl. webhooks | MEDIUM | CRITICAL | 🔴 | 🟢 (Day 1) |
| **R3** | customer.deleted dead write → stale data forever | HIGH | HIGH | 🔴 | 🟢 (Day 1) |
| **R4** | No metrics/alerting → all failures silent | HIGH | HIGH | 🔴 | 🟢 (Day 5) |
| **R5** | Reporting endpoints no authorization → data leak | HIGH | HIGH | 🔴 | 🟢 (Day 3) |
| **R6** | No BullMQ dead-letter queue → webhook events silently lost | LOW | HIGH | 🟡 | 🟡 (backlog) |
| **R7** | Single Redis instance for cache + throttler + BullMQ → triple failure | LOW | CRITICAL | 🔴 | 🟡 (backlog) |
| **R8** | Oracle XE 12GB cap → hard write failure | CERTAIN (eventually) | CRITICAL | 🔴 | 🟡 (requires PG migration) |
| **R9** | No PostgreSQL migration path → Oracle lock-in | LOW (today) | HIGH (future) | 🟡 | 🟡 (12-month horizon) |
| **R10** | JWT secret no rotation → breach = permanent token forgery | LOW | HIGH | 🟡 | 🟡 (post-Phase 3) |

---

## 6. APP SCORECARD

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Security** | **5.5/10** | JWT + refresh tokens with rotation ✅. Helmet + CSP + sanitization ✅. BUT: Reporting endpoints wide open (no RBAC) ❌. No audit trail ❌. PII in webhook CLOBs unencrypted ❌. No JWT secret rotation ❌. No account lockout ❌. |
| **Architecture** | **6.0/10** | Clean NestJS patterns + correct webhook pipeline ✅. Proper source-of-truth (Stripe) ✅. BUT: Stripe+DB write not atomic ❌. Oracle XE 12GB cap ❌. Single Redis for 3 subsystems ❌. No multi-instance scaling ❌. Tight Stripe coupling (accepted) ⚠️. |
| **Product Completeness** | **5.0/10** | Core payment flows solid ✅. Subscription management works ✅. Payment method handling good ✅. BUT: No refund capability ❌. No invoice visibility ❌. No dispute handling ❌. No admin dashboard ❌. Mobile broken ❌. First-time user onboarding missing ❌. |
| **Code Quality** | **6.5/10** | Clean NestJS patterns, strong validation, good error taxonomy ✅. BUT: 15% test coverage ❌. `@ts-nocheck` in tests ❌. `process.exit(1)` on unhandled rejection ❌. Duplicated code ❌. Dead shared-types package ⚠️. |
| **OVERALL** | **5.75/10** | **Not production ready.** Strong engineering foundation undermined by critical gaps in resilience (Redis throttler, Stripe-DB atomicity), observability (zero metrics/alerting), authorization (reporting endpoints), and product completeness (no refunds/disputes/invoices). With the 10-day Critical Path completed, expected score: **7.5/10** — production ready for MVP launch with known and managed risks. |

---

## 7. WHAT'S ALREADY FIXED (Prior Report Status)

The original `CODE_QUALITY_REPORT.md` (2026-05-05) identified 14 P0-P2 issues. Status as of 2026-05-19:

| Prior Finding | Status | Notes |
|---------------|--------|-------|
| P0-1: Redis failures crash endpoints (get/set/del) | ✅ Fixed | Try/catch in `redis.service.ts` lines 30-62 |
| P0-2: Hardcoded DEMO_CUSTOMER_ID | ✅ Fixed | Uses `useMyCustomer()` hook now |
| P0-3: No refresh tokens | ✅ Fixed | Full implementation: `token.service.ts` + `auth.service.ts` + `api-client.ts` |
| P1-1: No DB transaction | ⚠️ Partial | CustomersRepository + SubscriptionsRepository use `withTransaction()`. PI + SI repos still don't. |
| P1-2: No user→customer ownership | ✅ Fixed | `assertOwnership()` in all customer-scoped controllers |
| P1-3: Missing FK STRIPE_SUBSCRIPTIONS → SUBSCRIPTION_PLANS | ❌ Not fixed | Index created, FK never created (see C-3) |
| P1-4: In-memory throttler | ✅ Fixed | `RedisThrottlerStorage` implemented — BUT throttler path lacks error handling (see C-1) |
| P1-5: findByStripeId incomplete cache | ✅ Fixed | Now calls `findById()` for full object |
| P1-6: Reporting endpoints unprotected | ⚠️ Partial | Class-level throttle added. Authorization and ownership still missing (see C-5) |
| P2-1: LOG_FORMAT not validated | ✅ Fixed | Joi validation in `validation.schema.ts` |
| P2-2: Email uniqueness | ✅ Fixed | `UQ_CUSTOMER_EMAIL` constraint via migration 005 |
| P2-3: CSP unsafe-inline | ❌ Not fixed | Still present. Add Trusted Types as compensating control. |
| P2-4: No check constraints | ✅ Fixed | CHK_PI_STATUS, CHK_SUB_STATUS, CHK_WH_STATUS |
| P2-5: Plan cache no invalidation | ✅ Fixed | `POST /subscriptions/plans/sync` endpoint |

**Progress:** 9 fully fixed, 3 partially fixed, 2 not fixed. The unfixed items (CSP, FK) are the lower-severity ones.

---

## 8. WHAT ALL FOUR TEAMS MISSED — Blind Spots Discovered During Synthesis

These are issues that appeared in ZERO of the four initial analyses and were only caught during rebuttals:

| # | Blind Spot | Discovered By | Severity |
|---|-----------|---------------|----------|
| 1 | **Oracle XE 12GB cap** — When hit, database becomes read-only. All writes fail. Webhook processing stops permanently. STRIPE_WEBHOOK_EVENTS grows unbounded. | Systems Rebuttal BS-1 | CRITICAL (long-term) |
| 2 | **Single Redis for cache + throttler + BullMQ** — Triple cascading failure. All three subsystems share one Redis instance with different criticality levels. | Systems Rebuttal BS-2 | HIGH |
| 3 | **No BullMQ dead-letter queue** — After 3 retries, failed webhook events are permanently lost. No recovery mechanism. | Systems Rebuttal BS-3, Code Rebuttal BS #3 | HIGH |
| 4 | **Frontend sends no idempotency keys** — Backend has full infrastructure. Frontend never provides them. Double-click protection is purely UI-based. | Systems Rebuttal BS-4 | HIGH |
| 5 | **Webhook controller lying comment** — Claims "ThrottlerGuard is bypassed" but it's NOT. Webhooks ARE rate-limited despite the comment. | Code Rebuttal BS #1 | CRITICAL (addressed in Day 1) |
| 6 | **No dual webhook secret rotation** — Secret rotation requires a deployment window where both old and new secrets are valid. No support for this. | Systems Rebuttal BS-5 | MEDIUM |
| 7 | **Server actions don't use api-client's refresh flow** — Dual code path: api-client has 401→refresh→retry, server actions use raw fetch with no retry. | Systems Rebuttal BS-7 | MEDIUM |
| 8 | **BullMQ worker shares API process** — Billing cycle spikes saturate Node.js event loop, degrading checkout latency. | Product Rebuttal 3.3 | MEDIUM |
| 9 | **No audit trail** — Zero `audit_log` table. No record of who did what. SOC2/GDPR compliance blocker. | Governance Rebuttal BS #1 | CRITICAL (compliance) |
| 10 | **PII in webhook CLOBs unencrypted** — Complete Stripe payload with customer PII stored as plain text. No retention policy. GDPR data minimization violation. | Governance Rebuttal BS #2 | CRITICAL (compliance) |

---

## 9. TEAM PERFORMANCE ASSESSMENT

| Team | Accuracy | Depth | Actionability | Overall |
|------|----------|-------|---------------|---------|
| **Governance & Security** | 8.5/10 | 9/10 | 9/10 | **8.8/10** 🥇 |
| **Systems Architecture** | 8.0/10 | 9/10 | 8/10 | **8.3/10** 🥈 |
| **Code Quality** | 7.0/10 | 8/10 | 7/10 | **7.3/10** 🥉 |
| **Product Architecture** | 5.0/10 | 7/10 | 6/10 | **6.0/10** |

**Governance & Security** (🥇): Most technically precise. Correctly isolated the throttler path (incr/ttl/expire/setWithExpiry) from the cache path (get/set/del), which the Product team conflated. The C-1, C-2, H-1 findings are all source-verified and correctly prioritized. Only weakness: H-4 overstates the refresh gap and H-3 PCI reasoning is shaky. The rebuttal's blind spots (no audit trail, PII in webhooks, no compliance docs, no JWT rotation) are the most consequential findings any single team produced.

**Systems Architecture** (🥈): Strongest architectural overview. The state machine analysis, data flow diagrams, and module dependency graph are excellent. Correctly identifies `process.exit(1)`, `withTransaction()` inconsistency, and the production Docker gap. Weakened by: rating multi-provider abstraction as Risk #5 (wrong priority), missing the reporting authorization gap, and not connecting Redis → BullMQ → throttler as a shared-instance problem until the rebuttal. The rebuttal's blind spots (Oracle 12GB cap, single Redis, no DLQ) are critical long-term risks. Best overall architectural understanding.

**Code Quality** (🥉): Thorough file-by-file analysis. Correctly catches AsyncLocalStorage gap, auth.service raw-fetch gap, and code duplication. Weakened by: **severity inflation** (dead shared-types as P0, wrong-color error page as significant), **incorrectly marking reporting as "fixed"** (throttle ≠ authorization), and prioritizing developer-experience concerns over user-facing problems. The rebuttal (by a different reviewer) was the most source-verified of all rebuttals and correctly identified errors in other teams' analyses. Best code-level accuracy in the rebuttal round.

**Product Architecture** (4th): Good feature completeness mapping and webhook event coverage analysis. Correctly identifies the "Payment Operations Triangle" gap (refund/dispute/invoice). Weakened by: **two critical factual errors** — (1) claiming "no refresh tokens" when they demonstrably exist, (2) claiming Redis get/set crash when they were already fixed. Both errors were verified against source code by other teams. The "no refresh tokens" error is the most consequential mistake in any report — it would have wasted 3-5 days of engineering effort on something already built. The rebuttal showed strong product thinking on the double-charge scenario and error page trust signals. Best user-experience perspective, weakest source-code verification.

---

## 10. FINAL DIRECTIVE

**This app is 80% of the way to production readiness.** The remaining 20% is concentrated in five critical areas: Redis throttler resilience, Stripe-DB write atomicity, the customer.deleted dead write, observability, and reporting authorization. All five have known, specific, low-effort fixes documented in this report.

**Follow the 10-day Critical Path in order.** Do not skip ahead. Do not get distracted by multi-provider abstractions, CSP hardening, or test coverage targets. The first 2 days stop the bleeding (prevent crashes, prevent double-charges). Days 3-5 lock down the perimeter (authorization, monitoring). Days 6-8 harden (data integrity, rate limiting). Days 9-10 verify (integration tests, load tests, production config).

**Launch when:** Users can stay logged in, complete a payment without fear of double-charges, see accurate account information, and the app doesn't crash when Redis restarts. Everything else ships in Week 2.

**The single most important thing to fix:** The Redis throttler fail-open. It's 30 minutes of work and it prevents the most catastrophic failure mode in the entire system. Do it first.

---

*End of FINAL VERDICT. No further debate.*
