# Payment Method Rebuttal — Cross-Audit Debate Round

**Date:** 2026-05-19
**Audits Reviewed:** error-handling-audit.md, ux-failure-audit.md, compliance-idempotency-audit.md
**Payment Methods in Scope (11 total):**
card, bancontact, eps, p24, sepa_debit, us_bank_account (ACH), bacs_debit, au_becs_debit, link, amazon_pay, revolut_pay
**Cross-referenced with:** payment-method-audit.md

---

## Payment Method Architecture — How Each Type Flows

Understanding how the audits' findings hit differently across payment methods requires grasping the fundamental differences:

| Dimension | Cards | Bank Debits (SEPA/BACS/ACH/BECS) | Wallets (Apple Pay, Google Pay) | BNPL (Klarna, Affirm, Afterpay) | Redirect Methods (Bancontact, EPS, P24, Amazon Pay, Revolut Pay, Link) |
|---|---|---|---|---|---|
| **Setup** | Instant (on-session) | Async (micro-deposits: 1–3 days or instant via Financial Connections) | Instant tokenization | Credit check (real-time) | Redirect to bank/app for auth |
| **Capture** | Automatic | Automatic | Automatic | **Manual recommended** (capture on ship) | Automatic |
| **Off-session OK?** | ✅ (with 3DS at setup time) | ✅ (mandate-based) | ❌ (requires user presence) | ❌ (one-time) | ❌ (one-time) |
| **Statuses returned** | `succeeded`, `requires_action`, `requires_payment_method` | `processing`, `succeeded` | `succeeded` | `requires_capture`, `succeeded` | `succeeded` (after redirect) |
| **SCA/3DS path** | Yes — bank challenge page redirect | No — mandate auth is different | Device biometric | BNPL's own auth flow | Bank's own auth flow |

---

## ERROR-HANDLING AUDIT — PAYMENT METHOD REBUTTAL

### Finding 1: Stripe timeout >30s — Race with RequestTimeoutMiddleware

**AGREE and AMPLIFY:** The audit correctly identifies the `ERR_HTTP_HEADERS_SENT` race. But the payment-method-specific dimension it misses is: which methods are most exposed to this scenario?

- **Cards with 3DS:** The Stripe API call (`stripe.paymentIntents.create()`) is fast (<500ms). The 30s timeout is in the backend API call, not the bank's 3DS page. Card creation won't trigger this.
- **Bank debits:** Same — `create()` is an API call, not the async verification window. But `stripe.paymentIntents.confirm()` with bank debits can take longer due to mandate negotiation. This happens client-side via the SDK, not through our backend timeout.
- **BNPL:** The `create()` call is fast. The credit check happens in Klarna/Affirm's UI, not our API call.
- **The real scenario:** This timeout fires when Stripe's API is degraded, not when an individual payment method is slow. **All payment methods are equally affected** — this is an infrastructure concern, not a payment-method-specific one.

**DISAGREE (partial):** The audit says the `RequestTimeoutMiddleware` sends 503 at 30s. But 30s is extremely generous for a Stripe API call (their SLO is <2s). If this fires in production, it's because Stripe is having an outage, not because of any payment method's characteristics. The fix (add correlationId to middleware) is correct regardless.

**Which payment method breaks first:** None differently. This is a uniform infrastructure gap.

---

### Finding 2: 402 card_declined — correlationId missing from StripeExceptionFilter body

**AGREE and AMPLIFY:** Missing `correlationId` in the response body affects ALL Stripe errors, not just card declines. But the customer support impact varies dramatically by payment method:

- **Cards:** A card decline generates a support ticket. The support agent asks "what's the correlation ID?" The user can only provide it IF they're technical enough to check response headers (unlikely). Result: **unnecessary back-and-forth, delayed resolution.**
- **SEPA/BACS/ACH:** Bank debit failures during initial setup don't produce a `StripeCardError` — they produce `StripeInvalidRequestError` or the SetupIntent stays in `processing`. The correlationId gap matters less here because the error path is different.
- **BNPL:** Klarna/Affirm declines produce `StripeInvalidRequestError` (not `StripeCardError`). The `StripeExceptionFilter` still omits correlationId.
- **Wallets:** Apple Pay declines are surfaced as card errors (wallet tokenizes to `type: 'card'`), so this is identical to cards.

**Which payment method breaks first:** **Cards** — they're the highest-volume payment method, so the missing correlationId will be encountered most frequently by support teams handling card decline tickets.

---

### Finding 3: 429 rate limit — Retry-After hardcoded, in body not header

**AGREE and AMPLIFY:** The audit is correct that `retryAfter` should be an HTTP header. But the payment-method nuance:

- Stripe's rate limits are **per-API-key, not per-payment-method.** A flood of card payments can exhaust the limit for everyone, including low-volume methods like BECS. Bank debits and BNPL get collateral damage from card volume spikes.
- **SEPA/BACS/ACH** are particularly harmed by hardcoded `retryAfter: 5`: if a bank debit setup fails due to rate limiting, retrying after exactly 5 seconds might hit the same rate limit again (especially if multiple requests are queued). The actual Stripe `Retry-After` value is essential for bank debits because their processing is already slow (1–3 days), and additional artificial delays from incorrect retry timing compound the user's frustration.
- **BNPL:** If the BNPL provider's integration returns a rate-limit error, the client retries after 5 seconds and may produce a second, identical credit check — which could be flagged as duplicate by the BNPL provider.

**Which payment method breaks first:** **Bank debits (ACH/SEPA)** — they have the longest inherent latency and are most harmed by incorrect retry timing. A 5-second hardcoded retry into a still-hot rate limit window creates cascading failures for methods that already feel slow to the user.

---

### Finding 4: Oracle pool exhausted — Clean Stripe PI cancellation

**AGREE and AMPLIFY:** The audit correctly notes that the service cancels the Stripe PI on DB insert failure. But:

- **Cards:** Cancellation is safe — an orphaned PI for a card payment is just stuck in `requires_payment_method` state. No money moves. Stripe auto-cancels after a timeout anyway.
- **BNPL:** **This is the dangerous case.** If a Klarna/Affirm PaymentIntent is created with `capture_method: 'manual'`, the BNPL provider has already performed the credit check and reserved the user's credit line. Canceling the PI releases the authorization, but the user's credit check inquiry remains on their record. Repeated pool-exhaustion failures → multiple credit inquiries → user's credit score impact. This is an externality the audit doesn't consider.
- **Bank debits:** If a SetupIntent is created but the DB insert fails and we cancel the SI, the user's bank account setup attempt is silently lost. No credit impact, but a confusing user experience ("I added my bank account but nothing happened").

**DISAGREE (partial):** The audit calls this MEDIUM severity. For BNPL, this is HIGH — credit check residue is a real consumer harm.

**Which payment method breaks first:** **BNPL (Klarna/Affirm/Afterpay)** — credit check residue on pool exhaustion creates real-world consumer impact beyond the app.

---

### Finding 5: ORA-00060 deadlock — Concurrent subscription creation

**AGREE and AMPLIFY:** The `findActiveByCustomerAndPrice()` check is a business dedup, not idempotency dedup. Payment-method-specific:

- The race only matters if the same `customerId + priceId` is used twice concurrently — which is unlikely for a single user. The audit's scenario is artificially constructed.
- **Real scenario:** Two admin users creating a subscription for the same customer simultaneously. Unlikely but possible.
- **Payment method impact:** The Stripe subscription is created with the **customer's default payment method.** If two subscriptions are created in the race, Stripe idempotency prevents double creation (idempotency key passed to Stripe), but if that fails: the customer gets two subscriptions, both with the same default payment method. For bank debits, this could violate mandate terms (most mandates allow one active subscription per mandate).

**Which payment method breaks first:** None significantly — the race window is narrow and Stripe-level idempotency is the backstop. This is correctly assessed as MEDIUM.

---

### Finding 6: Redis sentinel failover — Fail-open design

**AGREE:** The fail-open design is correct for rate limiting (allow through) and caching (fall back to DB). Payment-method-specific:

- **High-value methods** (BNPL with large amounts, bank debits for recurring subscriptions) benefit from rate limiting being maintained during failover. Fail-open means a Redis outage during a surge of BNPL credit checks could result in those checks flooding Stripe, potentially triggering Stripe-level rate limits that affect ALL payment methods.
- **Low-value methods** (card with small amounts) are less impacted by rate-limit fail-open.

**Which payment method breaks first:** **BNPL** — during a Redis outage, rate-limit fail-open could allow a flood of BNPL credit checks, each of which is an expensive operation on the BNPL provider's side. This could trigger provider-level blocks.

---

### Finding 10: Unsupported currency — Deferred to Stripe, vague error message

**AGREE and AMPLIFY:** The audit correctly identifies that currency validation is deferred to Stripe. But the payment-method-specific aspect is more nuanced:

- The `AmountEntryForm` hardcodes currency-per-payment-method. But `cards` are hardcoded to `gbp` — cards are currency-agnostic (they work with any currency Stripe supports). The UI prevents users from selecting card + USD, which is a **self-inflicted restriction.**
- `link` → gbp — Link supports USD and EUR too. Same restriction.
- `amazon_pay` → gbp — Amazon Pay supports multiple currencies.
- `revolut_pay` → gbp — Revolut is multi-currency by design.
- Bank debits are correctly mapped: `sepa_debit` → `eur`, `bacs_debit` → `gbp`, `us_bank_account` → `usd`, `au_becs_debit` → `aud`.

**The currency restriction in the UI means even if the backend allowed any currency, users can't actually select it from the checkout.** The backend audit's concern about "no currency allowlist" is partially addressed by the frontend mapping, but it's fragile — a direct API call could send `sepa_debit` with `usd` and Stripe would reject it with a vague "Invalid payment request."

**DISAGREE (partial):** The audit rates this LOW because it's "functional." It's not functional for card users who want to pay in USD — a very common scenario. The hardcoded `card → gbp` is a bug, not a feature.

**Which payment method breaks first:** **Card** — the hardcoded `gbp` currency blocks the most common card use case (USD), generating support tickets: "Why can't I pay in dollars with my card?"

---

## UX-FAILURE AUDIT — PAYMENT METHOD REBUTTAL

### Finding P0: Subscription creation is broken

**AGREE and AMPLIFY:** This is the single most impactful finding across all three audits. The Subscribe button creates a **PaymentIntent** instead of a **Subscription**. This means:

- No payment method type can successfully create a subscription. Not cards, not bank debits, not wallets, not BNPL.
- The `useCreateSubscription` hook exists in the codebase but is **never called.** It's dead code.
- The URL params (`priceId`, `amount`, `currency`) are passed but **never consumed** by the checkout page.

**Payment method impact:**
- **Cards:** Would work for subscriptions if the flow existed — `setup_future_usage: 'off_session'` is already wired.
- **Bank debits (SEPA/BACS/ACH):** Would require a mandate setup flow — the `SetupForm` component exists and handles this, but it's only accessible from the payment methods page, not from the subscription flow.
- **BNPL:** Not suitable for subscriptions at all — no BNPL method supports recurring billing.
- **Wallets:** Not suitable for off-session — Apple Pay and Google Pay require user presence.
- **Redirect methods (Bancontact, EPS, P24):** Not suitable for subscriptions — one-time only.

**DISAGREE:** The audit calls this BROKEN and P0. There's nothing to disagree with. It IS broken, and it IS P0.

**Which payment method breaks first:** **All payment methods are equally broken for subscriptions.** None work because the code path doesn't exist. But **cards** would be the first to generate support tickets because they're the most commonly associated with subscription payments.

---

### Finding P1: Raw error messages during PI creation

**AGREE and AMPLIFY:** The `CheckoutPage.handleSubmit()` catch block passes `err.message` directly to the user. The payment-method-specific dimension:

- **Cards:** `StripeCardError` messages from the backend include decline codes like `"Your card was declined"`. This is somewhat intelligible but lacks the polished `stripe-errors.ts` mapping that the SDK-side confirms have. The audit notes that the **PI creation step** doesn't use `mapStripeError` — only the **payment confirmation step** does. So card decline errors during PI creation are raw.
- **Bank debits (SEPA/ACH/BACS):** If Stripe rejects a PI creation with a bank debit, the error might say something like `"The payment method type us_bank_account requires a customer with a US bank account"` — raw and technical.
- **BNPL:** Klarna/Affirm rejections at PI creation could say `"Amount too large for Klarna"` — technically correct but not user-friendly.
- **Wallets:** If a wallet PI creation fails, the error could be `"Apple Pay is not available for this merchant"` — raw.

**DISAGREE (partial):** The audit rates this POOR. The SDK-side `mapStripeError` is EXCELLENT. The gap is only in the **creation** step, not the **confirmation** step. For most payment methods, creation failures are rare (validation issues) — the real declines happen at confirmation (handled excellently). The severity should be MEDIUM for cards (where creation rarely fails at Stripe), but HIGH for bank debits (where creation can fail due to currency/country mismatches) and BNPL (amount limit rejections at creation time).

**Which payment method breaks first:** **Bank debits** — they have the most creation-time validation failures (currency mismatch, country mismatch, mandate restrictions) that produce raw technical errors users can't understand.

---

### Finding P1: No global 401 redirect — Session expired during payment

**AGREE and AMPLIFY:** This is a universal problem. But the payment-method-specific pain varies:

- **Cards (no redirect):** The session expiry is detected on the NEXT API call (e.g., fetching customer data). The user gets a cryptic "Session expired" message mid-checkout. They have no idea how to log back in.
- **Redirect methods (Bancontact, EPS, P24, 3DS cards):** **This is catastrophic.** The user is redirected to their bank, completes auth, returns to our app, and NOW the session is expired. The `verifyPaymentIntent` call on the success page catches this gracefully (the audit praised this). But if the expiration happens BETWEEN Stripe redirecting back and the success page loading, the user sees "Session expired" instead of "Payment successful." The money may have been taken, but the user gets an error screen.
- **BNPL:** BNPL redirects to Klarna/Affirm can take minutes. Session expiration during this window is highly likely. When the user returns, they see "Session expired" and think the purchase failed — even though Klarna approved it.
- **Bank debits:** Less affected since setup is in-page (no bank redirect for most bank debit methods).

**Which payment method breaks first:** **BNPL and redirect-based methods (Bancontact, EPS, P24, Amazon Pay, Revolut Pay)** — the redirect roundtrip is >1 minute, exceeding session timeout windows. Users complete auth at their bank, return to our app, and are greeted with "Session expired" instead of "Payment successful." This generates "Was I charged?" support tickets at high volume.

---

### Finding P2: No confirmation dialog for subscription cancel

**AGREE:** The audit is correct. Payment-method-specific:

- Immediate cancellation without confirmation is most dangerous for **bank debits** — canceling a subscription may not revoke the SEPA/BACS mandate. Stripe handles this automatically (canceling the subscription doesn't revoke the mandate), but the user might think canceling the subscription also cancels the mandate. They could be surprised by a future charge from a different service using the same mandate.
- For **cards,** canceling a subscription means the next billing attempt fails with `card_declined` if the payment method is also removed. The audit's P2 detach-warning finding compounds this.

**Which payment method breaks first:** **Cards** — combined with the missing detach-warning (below), a user can accidentally cancel their subscription AND remove their card, leaving no payment method and no subscription, with no warning at either step.

---

### Finding P2: No warning on detaching default payment method for active subscription

**AGREE and AMPLIFY:** The audit correctly identifies no warning on detach. Payment-method-specific:

- **Cards:** This is the most common scenario — a user removes their default card from the Payment Methods page, not realizing it's the payment method for their active subscription. Next billing cycle: `invoice.payment_failed`. User doesn't know why. No notification (also found by payment-method-audit Finding #4).
- **Bank debits (SEPA/BACS/ACH):** Even more serious — detaching a bank debit payment method may also require revoking the mandate. If the mandate is not properly revoked, the bank could still honor charges from Stripe. The user thinks they've stopped payments but the mandate is still active. This is a compliance issue in jurisdictions with strong consumer protection (EU PSD2, UK FCA).
- **Wallets:** Less affected — wallets are rarely the default for subscriptions since they can't be used off-session.
- **BNPL:** Not applicable — BNPL isn't used for subscriptions.

**DISAGREE (partial):** The audit rates this POOR. For bank debits with mandates, this is CRITICAL — it's not just a UX gap, it's a potential regulatory violation if users believe they've revoked authorization but the mandate persists.

**Which payment method breaks first:** **Bank debits (SEPA/BACS)** — removing a mandate-backed payment method without revoking the mandate creates ongoing authorization the user believes has been terminated. This generates "Why am I still being charged?" support tickets with potential chargeback/dispute escalation.

---

### Finding P2: Rate-limit error has no countdown/timer

**AGREE and AMPLIFY:** The frontend shows "Too many attempts" with a static "Try again" button. The user clicks it immediately, which fails again because the rate limit is still active. Payment-method-specific:

- **Cards:** Rate-limit errors during card payments typically occur when the user is rapidly retrying a decline (rage-clicking). The 3-attempt limit in `CheckoutForm` partially protects against this, but only for the confirmation step. PI creation has no retry counter.
- **BNPL:** Rate limits hit when the user tries multiple BNPL options in quick succession (Klarna declined → try Affirm → try Afterpay). Each is a separate PI creation. Without a countdown, the user blasts through all three, gets rate-limited, and is stuck with no guidance.
- **Bank debits:** Less likely to hit rate limits since setup is a one-shot flow.

**Which payment method breaks first:** **BNPL** — the multi-provider shopping pattern (try Klarna, then Affirm, then Afterpay) naturally triggers rapid PI creation, making rate-limit hits most likely. Without a countdown, the user has no idea when to retry.

---

### Finding: `api_connection_error` message conflates user internet with server outage

**AGREE and AMPLIFY:** The message says "check your internet connection" even when Stripe's API is down. Payment-method nuance:

- The `api_connection_error` from Stripe's SDK can indicate: (a) user's internet is down, (b) Stripe's API is down, or (c) a network issue between Stripe and the user/bank. For **redirect methods** (Bancontact, EPS, P24, 3DS), a connection error during the redirect flow is ALMOST NEVER the user's internet (the user is on the bank's page, which loaded fine) — it's definitely a bank or Stripe issue. The misleading message causes the user to check their WiFi while the actual problem is at the bank/Stripe level.
- For **cards,** it could be either, so the message is merely inaccurate, not harmful.

**Which payment method breaks first:** **Redirect methods** — during bank redirect flows, an `api_connection_error` is almost certainly NOT the user's internet, making the misleading message most confusing here.

---

## COMPLIANCE-IDEMPOTENCY AUDIT — PAYMENT METHOD REBUTTAL

### Finding 2.1 (CRITICAL): Subscription no idempotency-key dedup at DB layer

**AGREE and AMPLIFY:** The audit correctly identifies that the dedup relies on Stripe's idempotency layer, not our own. Payment-method-specific:

- **Cards:** Stripe-level idempotency for subscriptions with cards is reliable. If two identical subscription creation requests arrive, Stripe deduplicates. The `findByStripeId()` fallback catches the case where Stripe deduped but our DB didn't persist. This is robust enough for cards in practice.
- **Bank debits (SEPA/BACS/ACH):** **More fragile.** Subscription creation with a bank debit involves: create subscription → attach payment method → create mandate → confirm mandate. Stripe's idempotency covers the subscription creation, but the mandate lifecycle is separate. If subscription creation is deduped by Stripe, but the mandate setup is still in-flight, the cached response might not include the mandate. The service would return a subscription without a confirmed payment method.
- **BNPL:** Not applicable (no BNPL subscriptions).
- **Wallets:** Not applicable (no wallet subscriptions).

**DISAGREE (partial):** The audit says "if `idempotencyKey` is NOT passed to Stripe (code regression, refactor), we get double subscriptions." This is true but the same could be said about any Stripe API call. The real risk is not code regression — it's that **the mandate lifecycle for bank debits is not covered by Stripe's subscription-level idempotency.** A deduped subscription that references an incomplete mandate is a valid Stripe object but a broken user experience.

**Which payment method breaks first:** **Bank debits (SEPA)** — the mandate lifecycle decouples from subscription idempotency. A deduped subscription could return before the mandate is confirmed, leaving the subscription in `incomplete` status with no clear path to recovery.

---

### Finding 3.1 (CRITICAL): Stripe `confirmPayment` success + app crash → double charge

**AGREE and AMPLIFY:** The scenario: Stripe processes the payment, browser crashes before the success callback fires, user reopens app, creates a NEW PaymentIntent, pays again → charged twice. Payment-method-specific:

- **Cards (in-page, no redirect):** **Highest risk.** Card payments with `redirect: 'if_required'` that don't need 3DS complete in <2 seconds. The crash window is the gap between Stripe processing the charge and the browser's `confirmPayment` resolving. This is a genuine race — payment succeeds at Stripe's level, but the browser's JavaScript never knows about it. On reload, a fresh PI is created and the user pays again.
- **Cards (with 3DS redirect):** **Protected by Stripe's consumed-secret mechanism.** If the user completed 3DS at their bank, the PI is `succeeded`. When they reload, they can't reuse the client secret (it's consumed). They create a new PI → new payment. The original payment succeeded. **Double charge is possible.**
- **Redirect methods (Bancontact, EPS, P24):** **Protected by the URL.** The return URL contains `payment_intent=pi_xxx&redirect_status=succeeded`. Even if the user refreshes, the success page re-verifies. No double-charge risk UNLESS the user navigates back to `/checkout` instead of the success page.
- **BNPL:** **Higher risk than cards!** BNPL credit checks are a separate async operation. Klarna approves → funds reserved → our app crashes → user comes back → creates new PI → Klarna checks again → two credit checks (one reserved, one potentially approved). Even if only one is captured, the user has TWO credit inquiries on their record.
- **Bank debits:** **Lower risk.** ACH/SEPA are slow — processing takes days. Even if the app crashes, there's no immediate "double charge" because funds haven't moved. The duplicate PI would create a duplicate mandate, which Stripe may reject (one mandate per customer per payment method type).

**DISAGREE (partial):** The audit says the fix is localStorage-based `orderId` dedup. This doesn't help with the BNPL credit check problem — the credit check happens at the BNPL provider before localStorage can record anything. The dedup must be **server-side** (idempotency key tied to a purchase/cart, not to a technical retry key).

**Which payment method breaks first:** **BNPL** — double credit checks are a consumer harm beyond the financial double-charge. Each BNPL application is a hard or soft credit pull depending on the provider. Two in quick succession can degrade the user's credit score.

---

### Finding 4.2.1 (CRITICAL): No user account deletion

**AGREE and AMPLIFY:** GDPR Article 17 right to erasure. Payment-method-specific obligations:

- **Cards:** On account deletion, all card PaymentMethods must be detached from the Stripe Customer. Stripe's `detach` is the correct API call.
- **Bank debits:** **Mandates must also be revoked**, not just detached. A detached bank debit without revoked mandate still allows Stripe to debit the account (the mandate is a separate Stripe object from the PaymentMethod). The audit's fix doesn't mention mandate revocation — this is a critical omission.
- **SEPA specifically:** Under PSD2, the payer has the right to revoke a mandate at any time. Account deletion MUST trigger mandate revocation, or the business is non-compliant with PSD2.
- **BNPL:** No ongoing relationship — BNPL accounts are per-transaction. No special handling needed.
- **Wallets:** Wallet tokens are device-bound. No special handling needed beyond detaching the PaymentMethod.

**DISAGREE (partial):** The audit's fix says "Detach all payment methods from Stripe" but doesn't say "Revoke all mandates." For SEPA/BACS/ACH, detaching is insufficient — the mandate is a separate object that authorizes future debits independently of the PaymentMethod's attachment status.

**Which payment method breaks first:** **Bank debits (SEPA)** — account deletion without mandate revocation is a PSD2 violation with potential regulatory fines. This is the highest-compliance-risk payment method.

---

### Finding 4.2.3 (CRITICAL): Payment methods are hard-deleted

**AGREE and AMPLIFY:** Hard delete removes audit trail. Payment-method-specific audit trail requirements:

- **Cards:** Hard delete removes the evidence of what card was used. The `last4` and `fingerprint` are PCI-compliant truncated data — keeping them after soft-delete is acceptable. The GDPR fix should clear `billing_details` (PII) but retain `last4`, `brand`, and `fingerprint` for fraud/dispute purposes.
- **Bank debits:** Mandate information must be retained for audit purposes even after the payment method is "deleted." Under SEPA rules, mandate records must be kept for 13 months after the last transaction. Hard-deleting the payment method loses the mandate reference.
- **BNPL:** BNPL transactions reference the payment method. If it's hard-deleted, the transaction history loses context about how the user paid.
- **Wallets:** Wallet token metadata should be retained for dispute resolution.

**DISAGREE:** The audit says "Keep stripePaymentMethodId and type (non-PII) for audit purposes." But `type` alone is insufficient — `fingerprint` is essential for fraud detection (identifying the same card across different customers), and `country` + `funding` are needed for transaction analysis. The soft-delete should retain more fields than the audit suggests.

**Which payment method breaks first:** **Bank debits** — SEPA mandate retention requirements (13 months) are violated by hard delete, creating a regulatory exposure that card payments don't have.

---

### Finding 4.2.5 (HIGH): Webhook payloads contain PII with no TTL

**AGREE and AMPLIFY:** Encrypted payloads persist forever in `STRIPE_WEBHOOK_EVENTS.PAYLOAD`. Payment-method-specific:

- **Cards:** Webhook payloads contain `billing_details` (name, address, email) and `last4`. GDPR requires this to be purged.
- **Bank debits:** Webhook payloads contain full bank account metadata (last 4 of account number, bank name, routing metadata). This is more sensitive than card data in some jurisdictions.
- **BNPL:** Webhook payloads from BNPL providers contain granular purchase data (what was bought, shipping address, date of birth for credit checks). **This is the most sensitive payload type** — it's not just payment metadata, it's credit application data subject to FCRA (US) and consumer credit regulations (EU).
- **SEPA:** Mandate reference + IBAN-derivative data in webhook payloads.

**DISAGREE (partial):** The audit proposes a 90-day retention period. For BNPL, credit application data may have longer retention requirements under FCRA (up to 25 months for certain records). A blanket 90-day purge could be non-compliant with credit-reporting regulations. The retention period should be per-payment-method-type.

**Which payment method breaks first:** **BNPL** — credit application data in webhook payloads has the highest regulatory sensitivity (FCRA, GDPR, consumer credit laws). A one-size-fits-all retention policy that's too short violates credit reporting rules; too long violates GDPR.

---

### Finding 2.4 (HIGH): Frontend `subscriptions.service.ts` sends double idempotency keys

**AGREE:** True and clean. No payment-method-specific dimension — this is a pure client-side code issue.

**Which payment method breaks first:** None differently — it's a uniform code quality issue.

---

## CROSS-CUTTING: THE PAYMENT-METHOD-AUDIT FINDINGS

The payment-method-audit.md is the fourth report that the error-handling, UX, and compliance audits should have cross-referenced but didn't. Key intersection points:

### Payment-Method Finding #1: `requires_capture` not handled in PI status mapper — Intersects with UX Audit

The UX audit found that the `mapPaymentIntentStatus` handles `succeeded`, `requires_action`, etc., but never mentions `requires_capture`. The payment-method audit correctly identifies this as a HIGH-severity gap for BNPL. When a user completes a Klarna/Affirm checkout:

1. PI is created with `capture_method: 'manual'` (needed for BNPL)
2. User completes BNPL flow at Klarna/Affirm
3. PI status is `requires_capture`
4. `mapPaymentIntentStatus` hits the `default` case → "Unexpected status" → user sees error

**This makes the UX audit's "GOOD" rating for the payment confirmation step inaccurate for BNPL.** The UX auditor only looked at the card path.

### Payment-Method Finding #2: No `capture_method` support — Intersects with Error-Handling Audit

The error-handling audit's scenario 1 (PI creation) doesn't consider that BNPL requires `capture_method: 'manual'`. If this were supported, the PI creation error path would need to handle: what happens if the capture fails? Who captures? When?

The error-handling audit's PI creation error handling assumes `capture_method: 'automatic'` — the payment completes at confirmation time. For BNPL, the error surface is larger: confirmation → authorization → capture → success. Each step can fail differently.

### Payment-Method Finding #3: Wallets blocked by single `paymentMethodType` — Intersects with UX Audit

The UX audit's checkout flow analysis shows `paymentMethodTypes: [data.paymentMethodType]` is passed to Stripe. When `'card'` is selected, wallets are suppressed. The UX audit didn't catch this — it rated the checkout flow "GOOD" for the payment confirmation step, missing that wallet users can't even reach that step.

### Payment-Method Finding #4: Off-session payment failures have no user notification — Intersects with all three

This finding cuts across all three audits:
- **Error-handling audit:** No scenario for "subscription payment fails silently"
- **UX audit:** Subscription page shows `past_due`/`unpaid` badges but no "Update payment method" CTA
- **Compliance audit:** No GDPR consideration for notifying users of failed payments (financial harm)

### Payment-Method Finding #10: `mapSetupIntentStatus` missing `processing` — Intersects with UX Audit

The UX audit rated SetupForm handling as "GOOD" for all payment method types, but didn't consider that ACH returns `processing` (micro-deposits pending). The `mapSetupIntentStatus` maps `processing` to "Unexpected status" — the user sets up their bank account and sees an error message, even though everything is working correctly. The UX audit's "GOOD" rating is wrong for bank debits.

---

## RANKING: TOP 3 PAYMENT METHODS MOST LIKELY TO CAUSE CUSTOMER SUPPORT TICKETS

### #1 — Bank Debits (SEPA Direct Debit) — MOST LIKELY

**Why it wins the #1 spot:**

1. **Setup shows "Unexpected status."** ACH/SEPA/BACS setup returns `processing` — the app maps this to an error. User successfully adds their bank account but sees "Unexpected status." Ticket: "I added my bank account and it says it failed."

2. **Silent subscription payment failures.** When a SEPA subscription payment fails (insufficient funds, revoked mandate), there is ZERO user notification. Stripe's dunning runs silently. The user discovers the failure only when their service stops working. Ticket: "Why was my service cancelled? I thought I was paying."

3. **Detach without mandate revocation.** User removes their SEPA payment method. The mandate is NOT revoked. If the mandate is still active for another service or gets reused, the user is debited unexpectedly. Ticket: "I removed my bank details but you charged me again!"

4. **Account deletion doesn't revoke mandate.** GDPR deletion + PSD2 mandate revocation are both required. Neither happens. Ticket: "I deleted my account but you're still charging me!" (plus regulatory complaint).

5. **No per-country validation in UI.** `sepa_debit` is mapped to `eur` (correct), but the user's billing country must be in the SEPA zone. The UI doesn't collect billing country. If Stripe rejects the setup due to country mismatch, the user sees a raw error. Ticket: "Why can't I add my bank account?"

6. **Subscription idempotency gap hits bank debits hardest.** The decoupled mandate lifecycle means a deduped subscription could return before the mandate is confirmed. User sees "Subscription active" but payment method is unconfirmed. First billing attempt fails silently.

**Support ticket volume prediction: HIGH.** Bank debits have a long, multi-step setup that generates confusion at every status transition, combined with silent failure modes and regulatory non-compliance that users will escalate.

---

### #2 — BNPL (Klarna, Affirm, Afterpay) — SECOND MOST LIKELY

**Why it wins the #2 spot:**

1. **`requires_capture` = "Unexpected status" in UI.** Every successful BNPL transaction shows the user an error message. Not occasionally — EVERY TIME. The user completes the Klarna credit check, returns to our app, and sees "Payment ended with unexpected status." Ticket inevitability: 100% of BNPL transactions.

2. **Double credit check on app crash.** If the app crashes between Klarna approval and our success callback, the user re-does the purchase. Klarna runs a second credit check. User has two credit inquiries. Ticket: "Klarna shows two loan applications for the same purchase — fix this!"

3. **No `capture_method` support.** BNPL requires `capture_method: 'manual'` (pay on ship). Without it, BNPL auto-captures immediately. For digital goods, this is fine. For physical goods, the money is taken before the order ships — a consumer protection violation in some jurisdictions.

4. **Session expiry during BNPL redirect.** BNPL credit checks take 1-2 minutes. User's session expires while they're at Klarna/Affirm. They return to "Session expired" instead of "Payment successful." Ticket: "Klarna approved my purchase but your app says session expired — did I buy it or not?"

5. **Credit application data in webhook payloads with no retention policy.** Webhook payloads contain full credit application data (DOB, address, purchase details). No TTL means this persists forever (GDPR violation). If there's a data breach, the exposure is credit-application-level PII, not just payment data.

6. **Raw error messages at PI creation.** BNPL amount limits are strict ($35-$10K for Klarna). If the user's cart exceeds the limit, Stripe rejects the PI creation. The raw error message is shown. Ticket: "I can't check out with Klarna — it gives a weird error."

**Support ticket volume prediction: HIGH.** BNPL has a guaranteed error-on-every-transaction (finding #1) plus credit-impacting failure modes. Every BNPL user WILL file a ticket.

---

### #3 — Cards with 3D Secure — THIRD MOST LIKELY

**Why it wins the #3 spot:**

1. **Browser close during 3DS = lost payment with no resume.** User is redirected to their bank's 3DS challenge page, closes the browser, comes back — the PaymentIntent is in `requires_action` on Stripe but our app has lost the `clientSecret`. A fresh checkout creates a new PI. If the original PI was already authorized at the bank, the user may be charged but our app thinks the payment failed. Ticket: "My bank shows a pending charge but your app says the payment didn't go through."

2. **correlationId missing from error responses.** Card declines are the highest-volume error. Every support ticket for a card decline requires a manual lookup of the correlation ID from headers. This slows down resolution and frustrates users. Not a blocking issue, but a volume multiplier — many tickets would be self-serveable if correlationId were in the body.

3. **Retry-After hardcoded in body, not header.** Card users who hit rate limits (e.g., rapid retries on decline) get no timing guidance. They keep clicking "Try again" and keep failing. Ticket: "Your payment form is broken — it keeps saying 'too many attempts.'"

4. **Missing `request_three_d_secure` in off-session setup.** If a card is saved without 3DS at setup time, off-session charges will fail with `authentication_required`. The first subscription renewal: payment fails silently. User discovers their subscription lapsed. Ticket: "Why did my subscription stop? My card is valid."

5. **Hardcoded `gbp` currency for cards.** Cards are global but the UI hardcodes them to GBP. USD users (the largest e-commerce market) can't select USD with a card. Ticket: "Why can't I pay in dollars?"

**Support ticket volume prediction: MODERATE-HIGH.** Cards are the highest-volume payment method, so even low-percentage issues generate many tickets. But individual issues are less catastrophic than bank debit or BNPL problems — most card payments work fine.

---

## SUMMARY: WHAT EACH AUDIT MISSED

### Error-Handling Audit Missed:

- Does not consider that different Stripe error types (`StripeCardError` vs `StripeInvalidRequestError`) fire for different payment methods
- Assumes PI creation failures are uniform — BNPL amount-limit rejections are fundamentally different from card declines
- No scenario for BNPL `requires_capture` status handling (falls through to generic error)
- No scenario for bank debit `processing` status in SetupIntent
- The "unsupported currency" finding didn't catch the hardcoded `card → gbp` restriction in the UI

### UX-Failure Audit Missed:

- Rated checkout flow "GOOD" for payment confirmation — but only looked at the card path. BNPL shows "Unexpected status" on every transaction
- Rated SetupForm handling "GOOD" — but bank debits return `processing` which maps to an error
- Didn't notice that wallet users can't reach the payment form when `'card'` is selected (paymentMethodTypes restriction)
- The "no detach warning" finding didn't consider mandate implications for bank debits
- The success page was rated "GOOD" — but BNPL `requires_capture` never reaches the success state

### Compliance-Idempotency Audit Missed:

- Account deletion fix doesn't mention mandate revocation (PSD2 requirement for SEPA/BACS)
- Hard-delete fix for payment methods doesn't consider SEPA mandate retention requirements (13 months post-last-transaction)
- Webhook payload TTL is a blanket 90 days — BNPL credit application data may require longer retention under FCRA
- PaymentForm crash double-charge scenario is worse for BNPL (credit check residue) than for cards (purely financial)
- Subscription idempotency gap is most dangerous for bank debits (mandate lifecycle decoupling)

---

## OVERALL ASSESSMENT

The three audits are individually thorough but **payment-method-blind.** Each auditor appears to have traced the code path for `card` payments and assumed the findings generalize. They don't.

**The most dangerous finding across all three audits is the bank-debit "silent failure" chain:**

1. User sets up SEPA → sees "Unexpected status" (processing, mapped as error) → confused
2. Subscription created (if the flow ever gets fixed) → first payment works → user relieved
3. Card expires / bank account runs dry → off-session payment fails → ZERO notification
4. Subscription goes `past_due` → user doesn't know → service stops
5. User checks app → sees "past_due" badge → no "Update payment method" button → no CTA
6. User detaches payment method → mandate NOT revoked → no warning
7. User contacts support: "Why did my service stop? Why didn't you tell me?"

This is a 7-step failure chain where every step has a gap. No other payment method has this many sequential failure points.
