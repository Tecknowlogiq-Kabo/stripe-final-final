# Compliance, Idempotency & Governance Rebuttal

**Date:** 2026-05-19  
**Author:** Security & Governance Architect  
**Audited Reports:** error-handling-audit.md, payment-method-audit.md, ux-failure-audit.md

---

## Part 1: Per-Finding AGREE / DISAGREE Analysis

---

### A. ERROR-HANDLING AUDIT — Rebuttal

#### Finding 1: Stripe API timeout >30s (HIGH)

**AGREE.** The `RequestTimeoutMiddleware` → `StripeExceptionFilter` double-response race is real. The middleware checks `res.headersSent` before sending its 503, but the downstream filter does NOT — when the Stripe SDK's `StripeConnectionError` propagates through NestJS's exception layer after the timeout already fired, `StripeExceptionFilter` calls `response.status(status).json(...)` on an already-responded socket. This crashes with `ERR_HTTP_HEADERS_SENT` in production, and the error is swallowed (no crash handler wraps the filter's `catch()` method).

**AMPLIFY — SOC2 / PCI-DSS context:**
- SOC2 CC7.3 (Availability): The `ERR_HTTP_HEADERS_SENT` crash is an unhandled exception that leaves the response in an indeterminate state. If this happens during a PCI-relevant operation (payment capture), the audit trail is broken — there is no response logged, and the client cannot distinguish "payment succeeded, timeout on response" from "payment failed, timeout on Stripe."
- Stripe Support Correlation: When the middleware wins the race, the client receives a 503 with **no `stripeRequestId`** and **no `correlationId`**. If the Stripe PaymentIntent actually succeeded (rare but possible — Stripe's API can return 200 while the response is in flight), the merchant has no way to correlate the timeout with the successful charge. The customer was charged but the merchant's system shows a timeout error. This is a reconciliation nightmare.
- PCI-DSS Requirement 10.2: Every payment event must be traceable. The missing `correlationId` in the timeout response breaks end-to-end traceability.

**DISAGREE — severity understated.** The error-handling audit rates this HIGH. I rate it **CRITICAL** for production. The `ERR_HTTP_HEADERS_SENT` crash affects not just this one request — in Node.js, uncaught exceptions in filter handlers can destabilize the event loop. If the crash happens inside an async context that isn't properly guarded, it can terminate the process. This is an availability incident waiting to happen under load (e.g., Stripe partial outage causing widespread timeouts).

**DISAGREE — the proposed fix is incomplete.** Adding correlationId to both responses is necessary but insufficient. The actual fix is:
1. `RequestTimeoutMiddleware` must store a flag on `res.locals` (e.g., `res.locals.timedOut = true`) before sending.
2. `StripeExceptionFilter` must check `res.locals.timedOut || res.headersSent` before attempting to send a response. If the response is already sent, log the error and return silently.

---

#### Finding 2: 402 card_declined — missing correlationId in body (MEDIUM)

**AGREE** that `correlationId` is missing from `StripeExceptionFilter` response body.

**AMPLIFY:** While the `x-correlation-id` header is set by `CorrelationIdMiddleware` (which runs before all filters), HTTP headers are stripped by some proxy/CDN configurations and are not visible in browser devtools "Response" tab without expanding headers. Mobile SDK consumers (React Native, Flutter) that parse JSON bodies for error reporting will miss the correlation identifier entirely. This is a **production observability gap** — when a customer reports "I got a payment declined error," support needs the correlationId from a screenshot of the error body, not a header they can't see.

**DISAGREE — the severity MEDIUM rating is correct.** This is a traceability gap, not a monetary risk. The decline itself is handled correctly, and the `stripeRequestId` IS included (which partially covers Stripe-side correlation). However, end-to-end tracing (app → Stripe → app) requires both identifiers.

---

#### Finding 3: 429 rate limit — Retry-After in JSON body, not HTTP header (HIGH)

**AGREE.** This is the most operationally dangerous finding in the error-handling audit.

**AMPLIFY — Financial safety context:**
- Standards-compliant HTTP load balancers (AWS ALB, nginx, HAProxy), API gateways (Kong, Apigee), and CDNs (Cloudflare, Fastly) all parse the standard `Retry-After` HTTP response header to implement backpressure. A `retryAfter` field inside a JSON body is completely invisible to infrastructure.
- When Stripe rate-limits the application, the 429 response from the application does NOT propagate the rate limit to upstream infrastructure. Upstream proxies continue forwarding requests at full rate. This creates a **thundering herd amplification**: Stripe rate-limits the app → the app returns 429 (without header) → the load balancer doesn't back off → more requests hit the app → more 429s from Stripe → cascading failure.
- The hardcoded `retryAfter: 5` is worse than useless — it gives clients false confidence that "5 seconds" is the right wait time, when Stripe may have indicated 30s, 60s, or longer. After 5 seconds, clients retry, get another 429, and repeat. This turns a transient Stripe rate limit into a sustained error storm.
- **SOC2 CC8.1 (Change Management):** The hardcoded value will silently become wrong when Stripe changes rate limit windows. The application has no mechanism to detect or adapt.

**DISAGREE — the proposed fix should go further.** The error-handling audit suggests: "Set `response.setHeader('Retry-After', '5')` AND keep body field." I disagree with keeping the hardcoded value at all. The fix should:
1. Extract the actual `Retry-After` value from the Stripe API response. The Stripe Node SDK's `StripeRateLimitError` may expose this via `error.headers` or `error.raw.headers`. If unavailable, log a warning and use a conservative default (30s, not 5s).
2. Set `response.setHeader('Retry-After', actualValue)` as the primary mechanism.
3. Include `retryAfter` in the JSON body ONLY as a convenience for API clients, with the same extracted value.

---

#### Finding 4: Oracle connection pool exhausted (MEDIUM)

**AGREE** with the assessment. The per-request handling (cancel Stripe PI, return 500) is correct.

**AMPLIFY:** The audit correctly identifies the absence of a circuit breaker. Without one, if the Oracle pool is exhausted due to a slow query or connection leak, ALL subsequent requests for ALL operations (not just payment intents) will fail with 500 after `poolTimeout` (30s). This is a **systemic availability risk** — a single slow query in one service can degrade the entire application. The application has no mechanism to:
- Detect pool exhaustion (no health check endpoint queries pool stats)
- Shed load (no request throttling based on pool health)
- Self-heal (no connection reaping or forced reconnection)

**DISAGREE — severity should be LOW, not MEDIUM.** The audit notes this is "handled correctly per-request." Oracle connection pools are battle-tested and pool exhaustion is an infrastructure-level problem, not an application-level one. The `poolTimeout: 30` and `poolMax: 20` are reasonable defaults. A circuit breaker would be nice but is a P2 optimization, not a pre-launch blocker.

---

#### Finding 5: Oracle deadlock ORA-00060 (MEDIUM)

**AGREE** that the race window exists between `findActiveByCustomerAndPrice()` (SELECT outside transaction) and the INSERT inside the transaction.

**AMPLIFY:** The deadlock scenario produces correct behavior (Stripe subscription is cancelled on the losing path), but costs a Stripe API call and creates a Stripe audit trail entry for a subscription that was immediately cancelled. At scale, this wastes rate limit budget and creates noise in Stripe logs. More importantly, the deadlocked request returns a 500 to the client, which is confusing — the client sees "Internal server error" when the real problem is "you already have a subscription." This is a **UX + observability** gap, not a data integrity gap.

**DISAGREE — the severity is correctly MEDIUM.** The existing cleanup logic (cancel Stripe subscription in catch block) prevents orphaned resources. The fix (unique constraint + `INSERT ... WHERE NOT EXISTS` or optimistic locking) is straightforward but not launch-blocking.

---

#### Finding 6: Redis Sentinel failover not configured (MEDIUM)

**AGREE** that the ioredis client uses a plain URL with no sentinel configuration.

**AMPLIFY — Governance context:**
- The fail-open design for rate limiting and caching is architecturally sound and follows the principle of "degrade gracefully, don't deny service."
- HOWEVER: during a Redis Sentinel failover (typically 5-15 seconds), ALL Redis operations throw errors. Every request logs an error. The error log volume during a failover event can be substantial — at 1,000 req/s, that's 10,000 error log entries in 10 seconds. This can overwhelm log aggregation systems (Datadog, Splunk) and trigger false-positive alerts.
- The `retryStrategy` gap means ioredis uses its default retry behavior, which may not reconnect fast enough for Sentinel failover scenarios where the new master is elected within seconds but ioredis is still waiting on its default backoff.

**DISAGREE — this is a P2, not pre-launch.** If Redis Sentinel is not actually deployed in production, this finding is theoretical. The plain URL configuration works perfectly for single-node Redis or Redis Cluster (with a load balancer in front). Sentinel support should be added when the ops team confirms the Redis topology.

---

#### Finding 7: BullMQ backpressure — 10,000 webhooks (LOW)

**AGREE** — the queue design is solid. Events are persisted before enqueue, DLQ exists, Stripe retries cover transient DB failures.

**DISAGREE — severity is correctly LOW, but the audit misses an amplification.** The `@SkipThrottle()` on the webhook endpoint means an attacker who discovers the webhook URL could flood it with fake events, exhausting the Oracle connection pool and causing legitimate webhooks to fail. The `WebhookSignatureGuard` verifies signatures (mitigating most of this), but signature verification happens AFTER body parsing — a flood of well-formed JSON with invalid signatures still consumes DB connections for the idempotency check. A rate limit on the webhook endpoint (even a generous one, e.g., 500/min) would prevent this.

---

#### Finding 12: Cancel + webhook race (LOW)

**AGREE** that the "last writer wins" race between cancel and `customer.subscription.updated` is self-correcting via the next Stripe webhook.

**AMPLIFY:** The audit calls this "acceptable for an eventually-consistent system where Stripe is authoritative." This is correct framing. However, the window of inconsistency is not just a few milliseconds — it lasts from the moment the cancel endpoint writes `status: 'canceled'` until Stripe fires the next `customer.subscription.updated` event (which could be seconds to minutes later). During this window:
- The customer sees "Canceled" on their dashboard
- But Stripe shows the subscription as active (or past_due)
- If the customer contacts support, the support agent sees conflicting states

**DISAGREE — no disagreement.** The LOW severity is correct for production.

---

#### Cross-Cutting Finding A: StripeExceptionFilter omits correlationId (covered in Finding 2)

No additional amplification needed beyond Finding 2 above.

---

#### Cross-Cutting Finding C/D: retryAfter in body vs. header / hardcoded value (covered in Finding 3)

No additional amplification needed beyond Finding 3 above.

---

#### Cross-Cutting Finding E: Stripe SDK v17 error class hierarchy

**AGREE** that `instanceof` checks must be verified against the installed SDK version.

**AMPLIFY — Governance:** This is a **dependency management governance gap**. The application should have:
1. A unit test that imports every Stripe error class the filter checks against and verifies they still exist.
2. A CI check that runs on Stripe SDK version bumps.
3. An integration test that triggers each error type against Stripe's test mode and verifies the correct HTTP status code is returned.

Without these, a `yarn upgrade stripe` could silently break error handling. The `StripeIdempotencyError` deprecation is a real example — if this class no longer exists in the installed SDK, the `instanceof` check will silently return `false` and idempotency errors will fall through to the `else` clause → 500 instead of 409.

---

#### Cross-Cutting Finding F: No circuit breaker for Stripe API or Oracle

**AGREE** — this is a resilience gap.

**AMPLIFY:** The combined effect of no circuit breaker + no timeout on the API client (see ux-failure-audit Finding 4) means every Stripe API call during an extended outage consumes a Node.js event loop slot for the full duration of `maxNetworkRetries: 2` × (timeout per attempt). At 100 concurrent requests, this is 100 blocked slots. The event loop can't process other work. The application becomes unresponsive to health checks. The orchestrator (Kubernetes/Docker) kills and restarts the container. The new container immediately starts processing queued requests — and they all time out again. This is a **death spiral**.

**DISAGREE — this is P2 for initial launch.** Circuit breakers are standard production hardening but not required for "first dollar through the app." The risk is availability degradation during upstream outages, not monetary loss during normal operation.

---

### B. PAYMENT-METHOD AUDIT — Rebuttal

#### Finding 1/2: requires_capture not handled / no capture_method support (HIGH)

**AGREE** that `requires_capture` is missing from `mapPaymentIntentStatus` and no `capture_method` is passed to Stripe.

**AMPLIFY — Financial safety:**
- When a PaymentIntent is created with `capture_method: 'manual'` and the customer completes a BNPL flow (Klarna, Affirm, Afterpay), the PaymentIntent status is `requires_capture`, not `succeeded`. The current `mapPaymentIntentStatus` falls through to the `default` case: `"Payment ended with status 'requires_capture'. No charge was made."` 
- This message is catastrophically wrong. The customer DID authorize payment, and the BNPL provider has reserved the funds. The message says "No charge was made" — which is true (capture hasn't happened yet) but misleading — the customer's credit line is encumbered. If the customer reads this and tries again with a different payment method, they'll be double-authorized.
- **PCI-DSS / Card Network Rules:** For BNPL methods, the authorization-to-capture window varies by provider. Klarna authorizations typically expire in 7-28 days. If the merchant doesn't capture within the window, the authorization expires and the merchant must re-authorize — potentially at different terms (customer's credit check may fail on re-attempt).

**DISAGREE — the severity should be split.** The `requires_capture` status gap in the frontend is HIGH severity (user sees "Unexpected status" after a successful payment flow). The missing `capture_method` support is MEDIUM for launch — it only matters if BNPL methods are enabled. For an MVP launching with card-only payments, this is not blocking.

---

#### Finding 3: Single paymentMethodType blocks wallets (HIGH)

**AGREE.** When `card` is passed as the only `paymentMethodType`, the PaymentElement restricts displayed methods to cards only. Apple Pay and Google Pay show as wallet options under the card type, but Stripe's PaymentElement behavior when `payment_method_types: ['card']` is restrictive.

**AMPLIFY — Revenue impact:** Apple Pay users have 2-3× higher conversion rates than manual card entry. By silently hiding wallet options when "card" is selected, the merchant is leaving conversion on the table. This is a measurable revenue loss.

**DISAGREE — this is correctly rated HIGH for production.** But I want to add nuance: the fix the payment-method audit proposes (`paymentMethodTypes: data.paymentMethodType === 'card' ? undefined : [data.paymentMethodType]`) is correct but insufficiently tested. Setting `paymentMethodTypes: undefined` combined with `automatic_payment_methods: { enabled: true }` (which is already on the backend) allows Stripe to show ALL available methods, including bank debits. If the frontend's `AmountEntryForm` only intended to show cards, this change would accidentally surface bank debits, BNPL, and other methods. The fix must be paired with a frontend decision about which methods to gate.

---

#### Finding 4: Off-session payment failures have no user notification (HIGH)

**AGREE** — and this is the most financially dangerous finding across ALL THREE reports.

**AMPLIFY — This is the monetary loss finding.** See Part 2 below for the full analysis.

**DISAGREE — the audit understates the financial exposure.** The audit says "the user is never told their subscription payment failed. No dunning management." This is correct but doesn't capture the full blast radius:

1. **Involuntary churn:** Failed off-session payments are the #1 cause of involuntary churn for subscription businesses. Without notification, the churn rate from payment failures approaches 100% (customer doesn't know, doesn't fix payment method, subscription cancels).
2. **Chargeback risk:** When a customer discovers their subscription was canceled without their knowledge, they may dispute the most recent successful charge ("I didn't authorize this — I canceled my subscription" — even though they didn't, the payment failure effectively canceled it). 
3. **Card network penalties:** Excessive failed charges on expired/lost cards can trigger card network monitoring programs, especially for businesses above $1M/year in volume. Visa's VAMP and Mastercard's GMP programs watch for excessive authorization attempts on invalid cards.
4. **SOC2 CC7.1 (Processing Integrity):** The application processes recurring payments but has no mechanism to ensure successful completion. When a payment fails, the system should detect, notify, and remediate. Silent failure violates the processing integrity control objective.

**This finding is CRITICAL, not HIGH.**

---

#### Finding 5/6: No payment_method_options for bank debits / 3DS strategy (MEDIUM)

**AGREE** that these configurations should be added.

**DISAGREE — correctly rated MEDIUM, not launch-blocking.** The Stripe PaymentElement handles bank debit verification and 3DS automatically through its hosted UI. The `payment_method_options` are optimizations, not prerequisites. For an MVP with card-only, neither is relevant. For bank debits at launch, `verification_method: 'automatic'` is Stripe's default and works.

---

#### Finding 7: Missing payment_intent.amount_capturable_updated webhook (MEDIUM)

**AGREE** — the webhook is missing from the registry.

**AMPLIFY:** Without this webhook, the local DB's `amountCapturable` column is stale after PI creation. If the application later builds a capture UI that reads `amountCapturable` from the DB instead of fetching from Stripe, it will capture the wrong amount. This is a **future correctness risk** — the data exists but is unreliable.

**DISAGREE — correctly rated MEDIUM.** This only matters when BNPL/manual capture flows are implemented. It's a dependency of Findings 1/2 above.

---

#### Finding 8: SetupIntent redirect recovery missing (MEDIUM)

**AGREE** — no `setup_intent` URL param handling on `/payment-methods`.

**AMPLIFY:** This creates a dangling SetupIntent at Stripe when the user refreshes during a redirect flow. SetupIntents don't expire for 24 hours, so they persist as clutter. More importantly, if the bank authorization succeeded but the app lost context, the SetupIntent is in `succeeded` status but the user sees no confirmation — they may retry, creating a duplicate payment method at Stripe.

**DISAGREE — severity is correctly MEDIUM.** This is a polish gap, not a financial risk.

---

#### Finding 9/10: mapSetupIntentStatus missing processing / no bank verification timeline (MEDIUM)

**AGREE** that `processing` status is not handled and users aren't told about bank verification timelines.

**AMPLIFY:** ACH micro-deposit verification takes 1-3 business days. During this window, the SetupIntent is in `processing` status. The current frontend treats `processing` as an error (falls through to default: "Unexpected status"). The user sees an error, assumes setup failed, and may try again — creating multiple pending SetupIntents. This is confusing and wastes Stripe rate limit budget.

**DISAGREE — correctly rated MEDIUM.** Bank debits are a P2 payment method for most SaaS businesses. Card payments don't have this issue.

---

### C. UX-FAILURE AUDIT — Rebuttal

#### Finding 1.1: Raw error messages during PI creation (POOR)

**AGREE.** The `handleSubmit` catch block in `CheckoutPage` does `setError(err.message)` — passing raw technical errors to the user.

**AMPLIFY — Security consideration:** Raw error messages can leak internal details. If the API returns `"Cannot read properties of undefined (reading 'stripeCustomerId')"`, the user sees a stack-trace-like message. While this specific app uses controlled error messages on the backend, the frontend has no guard against unexpected error shapes. A backend bug that throws an unhandled exception with sensitive path details would be rendered directly to the user.

**DISAGREE — the audit doesn't mention the server-side checkout page.** The source code reveals TWO checkout pages: a server component (SSR) that reads `searchParams` and a client component (`'use client'`) that reads `useMyCustomer()`. The server component catches errors and renders them in `alert-error` divs. The client component handles step transitions. Neither handles `priceId` from URL params. The raw-error problem affects BOTH.

---

#### Finding 1.4: Stripe api_connection_error message conflates user internet with server outage (ADEQUATE)

**AGREE** that the message is misleading: "Please check your internet connection" could be a Stripe server-side issue.

**AMPLIFY — Trust erosion:** When users are told to "check their internet connection" but their internet is working fine, they blame the application. This erodes trust at the worst possible moment — during payment. The message should be neutral: "We're having trouble connecting to our payment provider. Please try again."

**DISAGREE — severity is ADEQUATE, not a launch blocker.**

---

#### Finding 2.3: Detach default payment method with no warning (POOR)

**AGREE.** The "Remove" button has no guard.

**AMPLIFY — Chain of failure:**
1. Customer detaches their default payment method (no warning)
2. Next subscription renewal: Stripe attempts charge on detached PM → fails
3. Stripe's dunning runs → all retries fail (PM is detached, not just expired)
4. `invoice.payment_failed` webhook fires
5. Invoice handler logs a warning — NO notification to user
6. `customer.subscription.updated` fires → subscription goes to `past_due`
7. User sees `past_due` badge on subscription dashboard
8. User has no "update payment method" CTA next to the affected subscription
9. Subscription eventually cancels
10. Merchant loses recurring revenue
11. Customer may dispute prior charges

This is a **seven-link failure chain** where any one link could prevent the bad outcome, but ALL seven are broken in the current code. This is a system-level governance failure — no one component is solely responsible, but the system as a whole fails to protect the customer.

**DISAGREE — rated POOR, should be HIGH.** This directly enables the monetary loss scenario described in Part 2.

---

#### Finding 3.1: Subscription creation is BROKEN

**AGREE.** The "Subscribe" button links to checkout, which creates a PaymentIntent, not a Subscription. The `useCreateSubscription` hook exists but is never called.

**AMPLIFY — This is the existential finding.** See Part 2.

**DISAGREE — the audit says "Rating: BROKEN" but doesn't emphasize financial impact enough.** If a customer pays $100 through the "Subscribe" flow expecting a monthly subscription and receives only a one-time charge, they have been misled. This is not just broken UX — it's a potential regulatory issue. Under UK Consumer Rights Act 2015 and EU Consumer Rights Directive, consumers must receive what they reasonably expected to purchase. A "Subscribe" button that creates a one-time charge creates a reasonable expectation of recurring service.

---

#### Finding 4.1/4.2: No global 401 interceptor (POOR)

**AGREE.** Session expiry leaves users stranded on the current page with a cryptic error.

**AMPLIFY — Security context:** The `middleware.ts` only checks for cookie presence, not validity. An attacker with a stolen but expired auth_token cookie passes the middleware check and reaches protected pages. The API returns 401 (correctly), but the attacker can enumerate which routes exist (404 vs. 401 vs. 200 with skeleton). This is a minor information disclosure vector.

**DISAGREE — correctly rated POOR for UX, MEDIUM for security.** The information disclosure is theoretical and low-impact.

---

#### Finding 5.1: Two-tab synchronization (POOR)

**AGREE** — no cross-tab sync.

**AMPLIFY — Data consistency risk:** In a two-tab scenario:
- Tab 1: User cancels subscription
- Tab 2: Shows subscription as "Active" for up to 60s (staleTime) + refetchOnWindowFocus is `false`
- Tab 2: User clicks "Cancel" again → sends `cancelAtPeriodEnd: true` for an already-canceled subscription → Stripe returns the subscription in its current state. The API handles this idempotently, but the user sees a confusing "Reactivate" button appear in both tabs.

**DISAGREE — P2, not launch-blocking.** Two-tab usage is an edge case. The stale data resolves on interaction.

---

#### Finding 5.4: No timeout on any fetch / no AbortController (ADEQUATE)

**AGREE** — eternal spinners with no cancel option.

**AMPLIFY — User behavior:** Without a cancel button, users will refresh the page or close the tab. A refresh during PI creation creates an orphaned PaymentIntent at Stripe (the PI was created but the client secret was lost). The PI exists in `requires_payment_method` status and will auto-expire after 24 hours — but in the meantime, the `amount_capturable` on the merchant's Stripe dashboard shows pending volume. This is an accounting annoyance, not a monetary risk.

**DISAGREE — correctly rated ADEQUATE.** Timeout + cancel is P2 hardening.

---

## Part 2: The Single Finding That Could Result in Actual Monetary Loss

### The Finding: BROKEN SUBSCRIPTION CREATION FLOW + NO OFF-SESSION PAYMENT FAILURE NOTIFICATION

**Primary report reference:** UX-Failure Audit Finding 3.1 (Subscription creation broken) + Payment-Method Audit Finding 4 (No off-session failure notification)

**Why this finding specifically:**

The broken subscription creation flow is not just a "UX bug" — it is a **revenue model failure**. Here is the monetary-loss scenario:

---

### Scenario A: The "Subscribe" Deception

1. **Customer visits plans page** → sees "Pro Plan — $50/month" → clicks "Subscribe"
2. **Checkout page opens** — AmountEntryForm appears, user must manually enter $50, select "Card", and click "Continue to Payment"
3. **User pays $50** — `stripe.confirmPayment()` succeeds, card is charged $50
4. **Checkout success page shows** — "Payment Successful" ✅
5. **NO subscription is created** — `useCreateSubscription()` was never called. No `POST /subscriptions` API call was made. Stripe has a one-time $50 PaymentIntent, not a recurring subscription.
6. **User returns to subscriptions page** — sees no active subscription. Confused. Maybe they think it takes time to provision.
7. **Next month:** No renewal charge. User contacts support. "I paid for a subscription but it's not working."

**Monetary loss mechanism:**
- Customer disputes the $50 charge as "product not received" → chargeback
- Chargeback fee: $15-$25 per dispute (Stripe)
- If chargeback rate exceeds 0.75%, the merchant enters a monitoring program (Visa VFMP/Mastercard ECM)
- Above 1%, Stripe may impose a reserve or terminate the account
- **Loss: $50 (reversed) + $15 (fee) + reputation damage + potential Stripe account risk**

**Scale:** Every single customer who clicks "Subscribe" is affected. 100% of "subscription" purchases are actually one-time payments.

---

### Scenario B: Silent Subscription Death (even if creation gets fixed)

Even after fixing the subscription creation flow, the off-session failure notification gap means:

1. Customer subscribes successfully → subscription created at Stripe + local DB
2. Month 1 payment succeeds
3. Month 2: Customer's card expires → Stripe renewal fails → `invoice.payment_failed` webhook fires
4. **InvoiceHandler logs `logger.warn()` — nothing else.** No user notification, no email, no in-app banner.
5. Stripe dunning retries 3 more times over the next ~2 weeks — all fail (card is expired)
6. Subscription goes `past_due` → `unpaid` → `canceled`
7. Customer has NO IDEA. They only discover the subscription was canceled when they try to use the service and it doesn't work.

**Monetary loss mechanism:**
- Involuntary churn: customer would have updated their card if notified
- Lifetime value (LTV) of a retained customer: $50 × 12 = $600/year
- Churn rate from payment failures without notification: near 100%
- LTV loss per affected customer: full remaining subscription value

---

### Scenario C: Detach Default → Silent Death (amplifies Scenario B)

When combined with the detach-without-warning gap:

1. Customer has an active subscription with Card A as default payment method
2. Customer adds Card B, sets it as default
3. Customer removes Card A ("Remove" button — no warning)
4. Card B later fails (expired, insufficient funds)
5. Stripe tries to charge Card B → fails → falls back to... nothing (Card A is detached)
6. No notification to user. Subscription dies silently.

---

### Why this beats all other findings for monetary loss:

| Other Candidate Finding | Why it's NOT the top monetary-loss finding |
|---|---|
| `ERR_HTTP_HEADERS_SENT` crash | Availability issue — no money is lost, payments just fail |
| `Retry-After` in wrong place | Operational issue — rate limits cause delays, not financial loss |
| Missing `correlationId` | Observability gap — harder to debug, but no direct loss |
| No circuit breaker | Availability issue — degradation, not loss |
| `requires_capture` unmapped | UX confusion for BNPL — but BNPL is not launch-critical |
| Wallet visibility blocked | Conversion optimization — revenue opportunity, not loss |
| No cross-tab sync | UX edge case — users adapt |
| No cancel confirmation | UX annoyance — action is reversible (Reactivate button exists) |

The broken subscription flow is **existential** to a subscription business. The off-session notification gap is **inevitable** — every subscription business has payment failures, and without notification, every failure becomes permanent churn.

---

## Part 3: Consolidated P0 Fix List — Minimum Changes Before First Dollar

These are the changes that **must** be implemented before a single real customer payment flows through the application. They are ordered by criticality.

---

### P0-1: FIX THE SUBSCRIPTION CREATION FLOW

**Risk:** Every "Subscribe" click creates a one-time charge instead of a subscription. 100% of subscription purchases are mis-processed. Chargeback risk. Regulatory risk.

**Root cause:** The "Subscribe" button navigates to `/checkout`, which creates a `PaymentIntent`, not a `Subscription`. The `useCreateSubscription()` hook is never called.

**Required changes:**

1. **Create a dedicated subscription checkout page** at `apps/web/src/app/subscribe/page.tsx` that:
   - Reads `priceId`, `amount`, `currency` from URL searchParams
   - Displays the plan details (name, price, interval) as read-only confirmation
   - Collects a payment method via PaymentElement (SetupIntent flow for off-session)
   - On SetupIntent success: calls `useCreateSubscription()` with `customerId`, `priceId`, and the new payment method ID
   - Shows success with subscription details

   OR (simpler MVP approach):

2. **Modify the checkout page** to detect subscription flow:
   - Read `priceId` from URL searchParams
   - If `priceId` is present: after payment confirmation, call `subscriptionsService.create()` with the plan details
   - The PaymentIntent's payment method gets attached as the subscription's default payment method

**Files to create/modify:**
- `apps/web/src/app/subscribe/page.tsx` (new) or modify `apps/web/src/app/checkout/page.tsx`
- `apps/web/src/app/subscriptions/page.tsx` — change "Subscribe" link to new flow

**Idempotency guarantee:** The existing `POST /subscriptions` endpoint already supports idempotency via `IdempotencyKey` decorator. The backend is ready — the frontend just needs to call it.

---

### P0-2: ADD OFF-SESSION PAYMENT FAILURE NOTIFICATION

**Risk:** Silent subscription death. 100% churn from payment failures. Revenue loss of full LTV for every affected customer.

**Root cause:** `InvoiceHandler` logs a warning on `invoice.payment_failed` but takes no notification action. No email. No in-app alert. No payment method update CTA.

**Required changes:**

1. **Minimum viable: In-app notification on subscription dashboard.**
   - In the subscription card component, when `status === 'past_due'` or `status === 'unpaid'`:
     - Show a prominent red banner: "Your payment failed. Please update your payment method to keep your subscription active."
     - Add an "Update Payment Method" button that navigates to `/payment-methods`
   - **File:** `apps/web/src/app/subscriptions/page.tsx` (add conditional rendering for `past_due`/`unpaid`)

2. **Add `lastPaymentError` to the subscription entity:**
   - When `invoice.payment_failed` fires, update the subscription row with the decline code and failure timestamp.
   - This enables the frontend to show WHY the payment failed (expired card, insufficient funds, etc.)
   - **Files:** `apps/api/src/entities/stripe-subscription.entity.ts`, `apps/api/src/webhooks/handlers/invoice.handler.ts`

3. **Add `customer.subscription.updated` handler logic to detect `active` → `past_due` transition:**
   - When a subscription transitions to `past_due`, trigger a notification (in-app)
   - **File:** `apps/api/src/webhooks/handlers/subscription.handler.ts`

**Out of scope for MVP but noted for P1:** Email notification (requires email service integration). Stripe's automatic emails (if enabled in Stripe Dashboard) serve as a temporary stopgap.

---

### P0-3: WARN BEFORE DETACHING DEFAULT PAYMENT METHOD

**Risk:** Customer silently breaks their subscription's payment flow. Combined with P0-2 (no failure notification), this creates a guaranteed subscription death spiral.

**Root cause:** The "Remove" button on payment methods has no check for whether the PM is the default for an active subscription.

**Required changes:**

1. **Frontend guard:**
   - When rendering the "Remove" button, check if this payment method is `isDefault` AND the customer has an active (or trialing, or past_due) subscription.
   - If both conditions are true: "Remove" button label changes to "Active subscription — cannot remove" (disabled).
   - OR: Show a confirmation dialog: "This card is used for your Pro Plan subscription. Removing it will cause your next payment to fail. Are you sure?"
   - **File:** `apps/web/src/app/payment-methods/page.tsx`

2. **Backend guard (defense in depth):**
   - In `PaymentMethodsService.detach()`, query for any active subscription using this payment method as default.
   - If found, throw `ConflictException` with message: "This payment method is the default for an active subscription. Update your subscription's payment method first."
   - **File:** `apps/api/src/payment-methods/payment-methods.service.ts`

---

### P0-4: FIX THE STRIPE EXCEPTION FILTER — DOUBLE-RESPONSE RACE + MISSING CORRELATION ID + RETRY-AFTER

**Risk:** `ERR_HTTP_HEADERS_SENT` crash on Stripe timeout race. Missing `correlationId` breaks end-to-end traceability for all Stripe errors. Hardcoded `retryAfter` in JSON body (not HTTP header) breaks rate limit propagation.

**Required changes:**

1. **Prevent double-response in StripeExceptionFilter:**
   - At the top of the `catch()` method, check `res.headersSent`. If true, log the error and return immediately (do not attempt to send a response).
   - **File:** `apps/api/src/common/filters/stripe-exception.filter.ts`

2. **Add `correlationId` to StripeExceptionFilter response body:**
   - Include `correlationId: request.correlationId` in `responseBody`.
   - **File:** `apps/api/src/common/filters/stripe-exception.filter.ts`

3. **Add `correlationId` to RequestTimeoutMiddleware 503 response:**
   - Read `req.correlationId` (it's set by `CorrelationIdMiddleware` which runs first in the pipeline).
   - Include it in the timeout JSON response.
   - **File:** `apps/api/src/common/middleware/request-timeout.middleware.ts`

4. **Set HTTP `Retry-After` header for rate-limit and connection errors:**
   - Use `response.setHeader('Retry-After', String(retryAfterSeconds))`.
   - Keep `retryAfter` in the JSON body for API clients.
   - **File:** `apps/api/src/common/filters/stripe-exception.filter.ts`

5. **Extract actual retry-after from Stripe (best effort):**
   - Attempt to read from `exception.headers['retry-after']` or the raw error response.
   - Fall back to 30s default (not 5s) if not available.
   - **File:** `apps/api/src/common/filters/stripe-exception.filter.ts`

---

### P0-5: ADD GLOBAL 401 INTERCEPTOR + MIDDLEWARE COOKIE VALIDITY CHECK

**Risk:** Expired sessions leave users stranded on protected pages with cryptic errors. Users cannot self-recover. Payment flows interrupted mid-transaction.

**Required changes:**

1. **Frontend: Global 401 interceptor.**
   - In a React context provider or a wrapper around `apiClient`, catch all `ApiError` with status 401.
   - On 401: redirect to `/auth/login?redirect=${window.location.pathname}`.
   - Don't intercept 401 on auth endpoints (login, register, refresh) to prevent redirect loops.
   - **File:** New file `apps/web/src/lib/auth-guard.tsx` or modify `apps/web/src/lib/api-client.ts`

2. **Backend: Middleware cookie validity check.**
   - The current `middleware.ts` only checks cookie presence. Add a lightweight validity check (verify JWT expiration) or accept that the API layer will return 401 and rely on the frontend interceptor (P0-5.1 above) for the recovery path.
   - **Minimal fix:** The frontend interceptor is sufficient for MVP. The middleware enhancement is P1.

---

### P0-6: ADD REQUIRES_CAPTURE TO mapPaymentIntentStatus

**Risk:** BNPL users see "Unexpected status" after successful authorization. Misleading message says "No charge was made" when funds are actually reserved.

**Required changes:**

1. Add `requires_capture` case to `mapPaymentIntentStatus`:
   ```typescript
   case 'requires_capture':
     return {
       title: 'Payment authorized',
       message: 'Your payment has been authorized and will be captured when your order is fulfilled.',
       recoverability: 'non-recoverable',
       action: 'No further action needed.',
     };
   ```
   - **File:** `apps/web/src/lib/stripe-errors.ts`

---

### P0-7: ADD RETRY BUTTON + FRIENDLY ERRORS ON PI CREATION FAILURE

**Risk:** Users see raw technical errors ("Failed to fetch", "Internal server error") when PaymentIntent creation fails. No retry mechanism — must re-enter all form data.

**Required changes:**

1. **Wrap PI creation errors in friendly messages:**
   - Map `err.message` to user-friendly equivalents using a simple lookup or the existing error patterns from `stripe-errors.ts`.
   - At minimum: "Network error" → "Connection failed. Please check your internet and try again." / "Internal server error" → "Something went wrong. Please try again."
   - **File:** `apps/web/src/app/checkout/page.tsx` (both server and client components)

2. **Add a "Try Again" button:**
   - When error state is set, show a "Try Again" button that calls `handleSubmit` again with the same form data.
   - Preserve form data in state so users don't re-enter amounts.
   - **File:** `apps/web/src/app/checkout/page.tsx`

---

## Part 4: Summary — P0 Fix List (condensed)

| # | Fix | Why P0 | Files |
|---|-----|--------|-------|
| **P0-1** | Subscription creation flow | 100% of "Subscribe" clicks are silently wrong — existential | checkout page, new subscribe page |
| **P0-2** | Off-session payment failure notification | Involuntary churn from every payment failure | invoice handler, subscription handler, subscription page |
| **P0-3** | Detach default PM warning | Prevents subscription payment breakage | payment-methods page, detach service |
| **P0-4** | StripeExceptionFilter fixes | Crash risk, traceability, rate-limit propagation | stripe-exception.filter.ts, request-timeout.middleware.ts |
| **P0-5** | Global 401 redirect | Users stranded after session expiry | api-client.ts, auth-guard provider |
| **P0-6** | `requires_capture` status mapping | BNPL users see "Unexpected status" | stripe-errors.ts |
| **P0-7** | Friendly PI creation errors + retry | Raw error messages, no retry button | checkout page.tsx |

---

## Part 5: What Does NOT Need to Be Fixed Before First Dollar

The three audit reports collectively identify many issues. These are important but can wait:

| Finding | Rationale for deferral |
|---------|----------------------|
| Redis Sentinel configuration | Redis is likely single-node in early production |
| Circuit breaker for Stripe/Oracle | Availability hardening — not needed for low-volume MVP |
| Oracle deadlock prevention (unique constraint) | Deadlock is handled gracefully with cleanup |
| `payment_method_options` for bank debits / 3DS | Stripe defaults work; card-only MVP unaffected |
| `payment_intent.amount_capturable_updated` webhook | Only matters with manual capture / BNPL |
| SetupIntent redirect recovery on `/payment-methods` | Edge case; users can re-add payment method |
| Bank verification timeline in UI | Bank debits are P2 payment method |
| Cancel subscription confirmation dialog | Action is reversible ("Reactivate" button exists) |
| Rate-limit countdown timer | Static retry button is functional |
| Cross-tab synchronization | Edge case; stale data resolves on interaction |
| `apiClient` timeout / AbortController | P2 hardening; users can refresh |
| Stripe SDK error class hierarchy verification | Mitigated by `else` fallback to 500 |
| Currency/payment-method country alignment | Demo app scope |
| SEPA/BACS mandate auth differentiation in UI | Bank debits are P2 payment method |
| AmountEntryForm offering bank debits with mismatched currencies | Demo app scope |

---

## Part 6: Governance Posture Assessment

**What this codebase does well (governance perspective):**

1. **Idempotency by default:** Every mutating API call from the frontend generates a UUID idempotency key. The backend deduplicates on `IDEMPOTENCY_KEY` in Oracle. This is the single most important anti-double-charge protection and it's done correctly.
2. **Stripe as source of truth:** The architecture correctly defers to Stripe for payment method validity, subscription status, and event processing. Local DB is a cache, not an authority.
3. **Webhook idempotency:** `STRIPE_WEBHOOK_EVENTS` table with `STRIPE_EVENT_ID` deduplication prevents double-processing.
4. **Orphan resource cleanup:** Both PaymentIntent and Subscription creation catch DB insert failures and cancel the Stripe resource.
5. **Webhook DLQ:** Failed webhook processing goes to Dead Letter Queue after 3 retries with exponential backoff.
6. **Stripe authentication errors are never exposed to clients:** `StripeAuthenticationError` → `INTERNAL_SERVER_ERROR` with "Payment service configuration error."
7. **Open-redirect prevention:** Login redirect validates relative paths.
8. **Rate limiting with fail-open Redis:** Rate limits degrade gracefully rather than blocking legitimate traffic.
9. **Correlation IDs on all responses (except StripeExceptionFilter):** The `CorrelationIdMiddleware` + `AllExceptionsFilter` correctly propagate trace IDs.

**Governance gaps that should be tracked for SOC2 readiness:**

| Gap | SOC2 Control | Remediation Timing |
|-----|-------------|-------------------|
| No audit trail for subscription state transitions | CC7.2 | P1 (after launch) |
| No user notification for payment failures | CC7.1 | P0-2 (this report) |
| `ERR_HTTP_HEADERS_SENT` unhandled crash | CC7.3 | P0-4 (this report) |
| No Stripe error class hierarchy CI test | CC8.1 | P2 |
| No circuit breaker for external dependencies | CC7.3 | P1 |
| `retryAfter` not propagated to infrastructure | CC7.3 | P0-4 (this report) |

---

## Conclusion

The three audit reports collectively identify a comprehensive set of issues. From a security and governance perspective, the **broken subscription creation flow** (P0-1) and the **missing off-session payment failure notification** (P0-2) are the findings most likely to cause actual monetary loss — through chargebacks, involuntary churn, and revenue model failure. The seven P0 fixes above constitute the minimum bar before a single dollar of real customer money flows through this application.
