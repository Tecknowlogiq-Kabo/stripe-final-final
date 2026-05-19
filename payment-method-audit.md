# Payment Method Compatibility Audit

**Date:** 2026-05-19  
**Scope:** Full frontend + backend Stripe integration  
**Prepared by:** Payment Method Compatibility Analyst

---

## Audit Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | `requires_capture` not handled in PI status mapper | HIGH | BNPL |
| 2 | No `capture_method` support — BNPL can't do manual capture | HIGH | BNPL |
| 3 | Single `paymentMethodType` blocks wallets in PaymentElement | HIGH | Wallets |
| 4 | Off-session payment failures have no user notification | HIGH | Off-session |
| 5 | No `payment_method_options` for bank debit verification | MEDIUM | Bank Debits |
| 6 | No `payment_method_options` for 3DS strategy | MEDIUM | Cards/SCA |
| 7 | No `payment_intent.amount_capturable_updated` webhook | MEDIUM | BNPL |
| 8 | SetupIntent redirects return to page with no URL-based verification | MEDIUM | All |
| 9 | `mapSetupIntentStatus` missing `processing` status | MEDIUM | All |
| 10 | No `us_bank_account` verification timeline communicated to user | MEDIUM | Bank Debits |
| 11 | SEPA/BACS mandate auth not differentiated from card auth in UI | LOW | Bank Debits |
| 12 | AmountEntryForm offers bank debits with mismatched currencies | LOW | Bank Debits |

---

## 1. CARD PAYMENTS

### 1.1 SCA / 3D Secure — Browser Close During Redirect

**Status:** PARTIALLY ADDRESSED

**What happens when the user closes the browser during 3DS:**

`PaymentForm.tsx` line 59 uses `redirect: 'if_required'`. When 3DS is triggered, the browser navigates to the issuing bank's challenge page. If the user closes the browser *during* that challenge:

1. `stripe.confirmPayment()` never resolves — the `catch` block at line 102 does **not** fire because it's a navigation, not an exception.
2. The PaymentIntent remains in `requires_action` at Stripe.
3. The `payment_intent.requires_action` webhook fires and `payment-intent.handler.ts` line 53-55 updates the local DB status to `requires_action`.
4. **Gap:** There is no user-facing reconnect path. The user sees no "your payment is awaiting authentication" screen. If they return to `/checkout`, a fresh PaymentIntent is created.

**What exists:**
- `/checkout/success/page.tsx` handles `payment_intent` + `redirect_status` query params properly.
- `mapPaymentIntentStatus` line 389-397 handles `requires_action` with a "try again" message.

**What's missing:**
- No poll-based recovery: if a PI is in `requires_action`, the app could poll for final status.
- No "resume payment" link in the payment history for `requires_action` PIs.
- No timeout handling — Stale `requires_action` PIs are not cancelled.

**Recommendation:** After PI creation, persist the `clientSecret` so the user can resume an interrupted 3DS flow on page reload. Add a `/checkout/resume` route that re-renders `StripeProvider` with the existing `clientSecret`.

**Files affected:**
- `apps/web/src/components/stripe/PaymentForm.tsx` lines 53-60
- `apps/web/src/app/checkout/page.tsx` lines 19-24 (clientSecret stored in component state, lost on unmount)
- `apps/web/src/app/checkout/success/page.tsx` lines 10-38

---

### 1.2 Card Decline Codes

**Status:** EXCELLENT

`stripe-errors.ts` maps all standard decline codes comprehensively:

| Decline Code | User Message | File:Line |
|---|---|---|
| `lost_card` / `stolen_card` / `pickup_card` | "flagged by your bank" | 237-243 |
| `card_velocity_exceeded` | "exceeded the number of attempts" | 245-252 |
| `do_not_honor` / `generic_decline` | "declined without providing a reason" | 263-269 |
| `insufficient_funds` | "insufficient funds" | 276-281 |
| `expired_card` | "your card has expired" | 285-291 |
| `incorrect_cvc` / `incorrect_number` | "card details are incorrect" | 293-300 |
| `fraudulent` / `issuer_not_available` | "security block" | 311-319 |
| `authentication_required` | "additional verification required" | 330-337 |

The `mapDeclineError` function (line 222-342) also provides `action` hints and appropriate `recoverability` levels.

**No gaps found.** ✅

---

### 1.3 Expired Card

**Status:** ADDRESSED ✅

`stripe-errors.ts` lines 285-291:
```typescript
case 'expired_card':
  return {
    ...base,
    title: 'Expired card',
    message: 'Your card has expired. Please use a different card.',
    action: 'Update your card details or use another card.',
  };
```

The user is told to update/use-another card. This is not a silent failure.

---

### 1.4 SCA Exemption Handling for Legacy Cards

**Status:** GAP — No SCA strategy configuration

**Finding #6 (MEDIUM):** Neither the `CreatePaymentIntentDto` nor the `PaymentIntentsService.create()` method includes `payment_method_options` for 3D Secure strategy.

`payment-intents.service.ts` lines 62-76:
```typescript
stripePI = await this.stripeService.paymentIntents.create({
  amount: dto.amount,
  currency: dto.currency.toLowerCase(),
  customer: stripeCustomerId,
  payment_method: dto.paymentMethodId,
  setup_future_usage: dto.setupFutureUsage,
  // ... no payment_method_options
});
```

For off-session recurring payments, Stripe recommends:
```typescript
payment_method_options: {
  card: {
    request_three_d_secure: 'any', // or 'automatic'
  },
}
```

Without this, off-session payments may fail with `authentication_required` because the initial on-session setup didn't perform 3DS. The `setup_future_usage: 'off_session'` helps, but combined with `request_three_d_secure: 'any'` provides a stronger guarantee.

**Conversely**, SCA exemptions (low-value, low-risk, transaction risk analysis) are handled by Stripe automatically but can be opted into via `payment_method_options.card.moto` or transaction risk analysis.

**Files to change:**
- `apps/api/src/payment-intents/payment-intents.service.ts` lines 62-76 — add `payment_method_options` when `setup_future_usage` is `off_session`
- `apps/api/src/payment-intents/dto/create-payment-intent.dto.ts` lines 1-56 — add optional `@IsString() @IsIn(['any', 'automatic']) requestThreeDSecure?: 'any' | 'automatic'`

---

## 2. BANK DEBITS (ACH, SEPA, BACS)

### 2.1 SetupIntent with Bank Account — Different Flow than Cards

**Status:** PARTIALLY ADDRESSED

The `SetupForm` component (`SetupForm.tsx`) uses a single `PaymentElement` with `stripe.confirmSetup()` for all payment method types. This is architecturally correct — the PaymentElement abstracts payment method differences.

However:

**Finding #10 (MEDIUM):** ACH (US bank account) setup has a fundamentally different user experience: it returns `processing` status while micro-deposits settle (1-3 business days), or requires Plaid/Finicity instant verification. The `SetupForm` (line 70-95) and `mapSetupIntentStatus` (lines 413-460) don't reflect this:

- `mapSetupIntentStatus` doesn't handle `processing` status at all — it falls through to the default "Unexpected status" handler (line 452-457).
- The SetupForm treats any non-null `statusError` from `mapSetupIntentStatus` uniformly as a failure.

**File:** `apps/web/src/lib/stripe-errors.ts` lines 413-460 — add `processing` case:
```typescript
case 'processing':
  return {
    title: 'Verification in progress',
    message: 'Your bank account is being verified. This may take 1-3 business days.',
    recoverability: 'non-recoverable',
    action: 'You will be notified once verification completes.',
  };
```

**Also:** The `SetupForm` currently only calls `onSuccess()` on line 81 without passing any result status. It should accept a result object so the parent can handle `processing` differently.

**Files to change:**
- `apps/web/src/lib/stripe-errors.ts` lines 413-460 — add `processing` to `mapSetupIntentStatus`
- `apps/web/src/components/stripe/SetupForm.tsx` lines 7-11, 81 — pass status result to `onSuccess`
- `apps/web/src/app/payment-methods/page.tsx` lines 107-113 — handle `processing` in `handleSetupSuccess`

---

### 2.2 Mandate Handling

**Status:** ADDRESSED ✅

`mandate.updated` webhook is registered in `webhooks.service.ts` line 63 and handled by `MandateHandler` (`mandate.handler.ts`), which re-syncs the PaymentMethod from Stripe. This ensures mandate status changes (e.g., `active`, `revoked`) are reflected locally.

---

### 2.3 Bank Account Verification Micro-Deposits

**Status:** NOT APPLICABLE to PaymentElement  

Stripe's PaymentElement handles US bank account verification internally (Financial Connections or micro-deposits). The app doesn't need to implement its own micro-deposit flow. However, the **user experience** gap (Finding #10 above) means users aren't told about the timeline.

---

### 2.4 No `payment_method_options` for Bank Debits

**Finding #5 (MEDIUM):** When creating a PaymentIntent with `us_bank_account`, SEPA, or BACS, Stripe allows per-payment-method-type configuration that is not present:

```typescript
// Stripe recommends for US bank account:
payment_method_options: {
  us_bank_account: {
    verification_method: 'instant', // or 'automatic', or 'microdeposits'
    financial_connections: { permissions: ['payment_method'] },
  },
}
// For SEPA:
payment_method_options: {
  sepa_debit: {
    mandate_options: {
      reference: 'INV-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    },
  },
}
```

**Files to change:**
- `apps/api/src/payment-intents/payment-intents.service.ts` lines 62-76 — add `payment_method_options` based on `payment_method_types`
- `apps/api/src/payment-intents/dto/create-payment-intent.dto.ts` — add optional `paymentMethodOptions` field

---

## 3. WALLETS (Apple Pay, Google Pay)

### 3.1 Different Token Format

**Status:** ADDRESSED ✅

Wallet payments tokenize to `type: 'card'` with a `wallet` subfield. `stripe-errors.ts` lines 36-40 correctly detect this via `getPaymentMethodLabel()`:
```typescript
const wallet = pm.card?.wallet?.type;
if (wallet === 'apple_pay') return 'Apple Pay';
if (wallet === 'google_pay') return 'Google Pay';
```

The `PaymentForm` handles wallets by enabling them in the PaymentElement options (line 124-127):
```typescript
wallets: {
  applePay: 'auto',
  googlePay: 'auto',
},
```

`SetupForm` correctly disables wallets (line 104) since they can't be used off-session.

---

### 3.2 Wallet Availability Blocked by Single paymentMethodType

**Finding #3 (HIGH):** The checkout flow sends a single `paymentMethodType` to Stripe:

`apps/web/src/app/checkout/page.tsx` line 57:
```typescript
paymentMethodTypes: [data.paymentMethodType],
```

When `['card']` is passed, the PaymentElement **restricts** displayed methods to only card. Apple Pay and Google Pay will NOT appear, even though `wallets: { applePay: 'auto', googlePay: 'auto' }` is set. Wallets only appear when `paymentMethodTypes` is not explicitly restricted, or when `'card'` is present AND wallets are enabled (but in practice, Stripe may not show wallets when `payment_method_types` is specified).

**Fix:** When `card` is selected, either:
(a) Don't pass `paymentMethodTypes` at all (use `automatic_payment_methods`), which lets the PaymentElement show all available methods including wallets, OR
(b) Pass `['card', 'link']` and let wallets appear through the card type,

OR (recommended) — don't restrict `paymentMethodTypes` when `card` is selected:

`apps/web/src/app/checkout/page.tsx` line 57:
```typescript
// Change from:
paymentMethodTypes: [data.paymentMethodType],
// To:
paymentMethodTypes: data.paymentMethodType === 'card' ? undefined : [data.paymentMethodType],
```

**Files to change:**
- `apps/web/src/app/checkout/page.tsx` line 57

---

### 3.3 Wallet-Specific Decline Reasons

**Status:** ADDRESSED ✅

Generic wallet declines (Apple Pay cancel, Google Pay cancel) are handled via the `abort` error type detection in `stripe-errors.ts` lines 200-207. Card declines occurring through wallets use the same `card_error` handling with contextual labels ("Apple Pay was declined").

---

## 4. BUY NOW PAY LATER (Affirm, Klarna, Afterpay)

### 4.1 Different Capture Flow

**Finding #1 (HIGH):** BNPL methods (Klarna, Affirm, Afterpay, Zip) typically require `capture_method: 'manual'` because:
- Klarna: Payment must be captured when the order ships, not at checkout
- Affirm: Similar — authorization at checkout, capture on fulfillment
- Afterpay/Clearpay: Same pattern

The current PI creation flow (`payment-intents.service.ts` line 62-76) never sets `capture_method`, defaulting to `automatic`. For BNPL transactions, this means the payment is captured immediately at checkout — acceptable for digital goods but incorrect for physical goods.

**What's missing:**
1. `CreatePaymentIntentDto` has no `captureMethod` field
2. `PaymentIntentsService.create()` doesn't pass `capture_method` to Stripe
3. No API endpoint for capturing a PaymentIntent
4. No webhook handling for `payment_intent.amount_capturable_updated`

**Files to change:**
- `apps/api/src/payment-intents/dto/create-payment-intent.dto.ts` — add `@IsOptional() @IsIn(['automatic', 'manual']) captureMethod?: 'automatic' | 'manual'`
- `apps/api/src/payment-intents/payment-intents.service.ts` line 62 — pass `capture_method` to Stripe
- `apps/api/src/payment-intents/payment-intents.service.ts` — add `capture(id: string, amount?: number)` method
- `apps/api/src/payment-intents/payment-intents.controller.ts` — add `POST /payment-intents/:id/capture` endpoint

---

### 4.2 `requires_capture` Status Not Handled in Frontend

**Finding #1 (cont.):** `mapPaymentIntentStatus` in `stripe-errors.ts` lines 350-407 does not handle `requires_capture`.

When a PI is created with `capture_method: 'manual'` and the customer completes the BNPL flow, the status is `requires_capture`, not `succeeded`. Currently, this falls to the `default` case:
```typescript
default:
  return {
    title: 'Unexpected status',
    message: `Payment ended with status "${status}". No charge was made.`,
    recoverability: 'retry',
    action: 'Please try again or contact support.',
  };
```

This is confusing — the user did everything right, but sees "Unexpected status."

**Fix:** Add `requires_capture`:
```typescript
case 'requires_capture':
  return {
    title: 'Payment authorized',
    message: 'Your payment has been authorized and will be captured when your order ships.',
    recoverability: 'non-recoverable',
    action: 'No further action needed.',
  };
```

**Files to change:**
- `apps/web/src/lib/stripe-errors.ts` lines 350-407 — add `requires_capture` case

---

### 4.3 Missing `payment_intent.amount_capturable_updated` Webhook

**Finding #7 (MEDIUM):** `webhooks.service.ts` line 38-42 registers only:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `payment_intent.processing`
- `payment_intent.requires_action`

Missing: `payment_intent.amount_capturable_updated`, which fires when the `amount_capturable` field changes (important for partial capture flows and BNPL). Without this, the local DB's `amountCapturable` column is never updated after the initial PI creation.

**Files to change:**
- `apps/api/src/webhooks/webhooks.service.ts` line 38-42 — add `['payment_intent.amount_capturable_updated', paymentIntentHandler]`
- `apps/api/src/webhooks/handlers/payment-intent.handler.ts` lines 20-56 — add handler case

---

### 4.4 BNPL Decline Handling

**Status:** ADDRESSED ✅

`stripe-errors.ts` lines 132-154 handle BNPL-specific errors:
- `payment_method_customer_decline` — customer failed credit check
- `amount_too_large` / `amount_too_small` — exceeds BNPL amount limits

These provide clear, actionable messages with `recoverability: 'recoverable'` suggesting a different payment method.

---

## 5. CUSTOMER-PRESENT vs CUSTOMER-NOT-PRESENT

### 5.1 Off-Session Payment Failures

**Finding #4 (HIGH):** Off-session payments fail when:
- The saved card has expired
- The issuing bank requires SCA
- The card was reported lost/stolen

When this happens, Stripe fires `invoice.payment_failed`. The `InvoiceHandler` (`invoice.handler.ts` lines 63-73) handles this by logging:
```typescript
case 'invoice.payment_failed':
  if (invoice.subscription) {
    this.logger.warn({
      message: 'Invoice payment failed for subscription',
      // ...
    });
    // Subscription status will be updated via customer.subscription.updated event
  }
  break;
```

The `customer.subscription.updated` event WILL update the subscription status (to `past_due` or `unpaid`) via `subscription.handler.ts`. However:

1. **No user notification** — The user is never told their subscription payment failed.
2. **No dunning management** — Stripe handles retries automatically, but the app doesn't track retry state or communicate it.
3. **No failed payment reason stored on the subscription** — The subscription entity (`stripe-subscription.entity.ts`) has no error fields.

**What the code relies on:** Stripe's own dunning (retry up to 4 times) + Stripe's automatic emails. But if Stripe emails are disabled, the user gets nothing.

**Files to change:**
- `apps/api/src/entities/stripe-subscription.entity.ts` — add `lastPaymentError` field
- `apps/api/src/webhooks/handlers/invoice.handler.ts` lines 63-73 — add notification logic
- `apps/api/src/webhooks/handlers/subscription.handler.ts` — detect `active` → `past_due` transition and trigger notification
- `apps/web` — add subscription status display with payment failure reason

---

### 5.2 Recurring Payment Failure → Subscription Status Update

**Status:** PASSIVE — works via Stripe, but no app-level feedback

When `invoice.payment_failed` fires and Stripe retries fail, Stripe sets the subscription to `past_due` or `unpaid`. The `customer.subscription.updated` webhook fires and `subscription.handler.ts` syncs it. This works, but is entirely passive.

**Gap:** There's no application-level check: "Did this subscription just fail a payment? Should we show the user a banner to update their payment method?"

**Files to change:**
- `apps/web/src/app/subscriptions` (or wherever subscriptions are displayed) — surface `past_due`/`unpaid` status with a call-to-action to update payment method

---

### 5.3 `setup_future_usage: 'off_session'` is Correctly Propagated

**Status:** ADDRESSED ✅

The `CreatePaymentIntentDto` accepts `setupFutureUsage: 'on_session' | 'off_session'` (line 30-31), and `payment-intents.service.ts` line 68 passes it to Stripe:
```typescript
setup_future_usage: dto.setupFutureUsage,
```

When the checkout page's `savePaymentMethod` checkbox is checked, `'off_session'` is sent:
```typescript
setupFutureUsage: data.savePaymentMethod ? 'off_session' : undefined,
```

Similarly, `SetupIntentsService` defaults to `off_session` (line 43):
```typescript
usage: dto.usage ?? 'off_session',
```

This means saved cards can be used for future off-session charges. ✅

---

## 6. ADDITIONAL FINDINGS

### 6.1 AmountEntryForm Currency / Payment Method Mismatches

**Finding #12 (LOW):** `AmountEntryForm.tsx` lines 15-27 maps payment methods to currencies:

| Payment Method | Currency |
|---|---|
| `card` | `gbp` |
| `sepa_debit` | `eur` |
| `us_bank_account` | `usd` |
| `bacs_debit` | `gbp` |
| `au_becs_debit` | `aud` |

While the currency mapping is correct, the form doesn't validate that the bank debit method's country matches. For example, `sepa_debit` requires a European billing address, but the form doesn't collect billing details. The PaymentElement handles collection at Stripe's level, but there's no pre-validation.

Additionally, `card` defaults to `gbp` but cards work globally. The hardcoded currency for `card` is misleading.

**No change required** for production — this is a demo app with demo ranges.

---

### 6.2 SetupIntent Redirect Recovery

**Finding #8 (MEDIUM):** `SetupForm.tsx` line 41 sets:
```typescript
return_url: `${window.location.origin}/payment-methods`,
```

When a setup requires a redirect (e.g., 3DS for card setup, bank auth for SEPA mandate), the user is sent to the bank and then back to `/payment-methods`. The `stripe.confirmSetup()` promise resolves after the redirect, which is correct.

However, if the user refreshes the page during the redirect, the SetupForm is destroyed and `setAddingNew` is reset. The SetupIntent may be left in a dangling state. Unlike the checkout flow which has `/checkout/success?payment_intent=...`, there's no equivalent for setup redirects.

**Recommendation:** Add `setup_intent` + `redirect_status` URL param handling in `payment-methods/page.tsx`, similar to the checkout success page pattern.

**Files to change:**
- `apps/web/src/app/payment-methods/page.tsx` — add `useSearchParams` for `setup_intent` / `redirect_status` after mount

---

### 6.3 `mapSetupIntentStatus` Missing `processing`

**Finding #9 (MEDIUM):** `stripe-errors.ts` `mapSetupIntentStatus` (lines 413-460) handles:
- `succeeded`, `requires_payment_method`, `requires_action`, `canceled`, `requires_confirmation`, default

Missing: `processing` — which occurs for bank account setups.

See Finding #10 for the fix.

---

## 7. SUMMARY OF REQUIRED CHANGES

### HIGH Priority

| # | Change | Files |
|---|--------|-------|
| 1 | Add `requires_capture` to `mapPaymentIntentStatus` | `apps/web/src/lib/stripe-errors.ts` ~line 398 |
| 2 | Add `capture_method` support to PI creation | `apps/api/src/payment-intents/dto/create-payment-intent.dto.ts`, `apps/api/src/payment-intents/payment-intents.service.ts` |
| 3 | Fix wallet visibility when `card` is selected | `apps/web/src/app/checkout/page.tsx` line 57 |
| 4 | Add user notification path for off-session failures | `apps/api/src/webhooks/handlers/invoice.handler.ts`, `apps/web/src/app/subscriptions/*` |

### MEDIUM Priority

| # | Change | Files |
|---|--------|-------|
| 5 | Add `payment_method_options` for bank debits | `apps/api/src/payment-intents/payment-intents.service.ts`, DTO |
| 6 | Add `request_three_d_secure` for off-session cards | `apps/api/src/payment-intents/payment-intents.service.ts`, DTO |
| 7 | Add `payment_intent.amount_capturable_updated` webhook | `apps/api/src/webhooks/webhooks.service.ts`, handler |
| 8 | Handle `setup_intent` in URL on `/payment-methods` | `apps/web/src/app/payment-methods/page.tsx` |
| 9 | Add `processing` to `mapSetupIntentStatus` | `apps/web/src/lib/stripe-errors.ts` |
| 10 | Show bank verification timeline to user | `apps/web/src/components/stripe/SetupForm.tsx`, `apps/web/src/app/payment-methods/page.tsx` |

### LOW Priority

| # | Change | Files |
|---|--------|-------|
| 11 | Differentiate bank mandate auth from card auth in UI | `SetupForm.tsx` |
| 12 | Validate currency/payment-method-country alignment | `AmountEntryForm.tsx` (optional for demo) |

---

## 8. WHAT WORKS WELL

This codebase has many strengths worth preserving:

1. **Error mapping** (`stripe-errors.ts`): The decline code matrix is comprehensive, user-friendly, and context-aware (payment method labels, wallet detection, actionable hints).

2. **Idempotency**: Both PI and SI creation check idempotency keys before calling Stripe, preventing double-charges.

3. **Orphan prevention**: DB insert failures after Stripe API success trigger cancellation of the Stripe resource (PI lines 134-145, SI lines 102-113).

4. **Webhook Idempotency**: `STRIPE_WEBHOOK_EVENTS` table ensures no event is processed twice.

5. **Webhook coverage**: The handler registry covers all critical event types including `mandate.updated`.

6. **Wallet detection**: `getPaymentMethodLabel()` correctly identifies Apple Pay, Google Pay, Link, and other wallet-tokenized cards.

7. **BNPL-specific error codes**: `payment_method_customer_decline`, `amount_too_large`, `amount_too_small` are handled with method-appropriate messages.

8. **Redirect verification**: `/checkout/success` has a graceful fallback when the session is lost (line 89-91 in verify.ts).

9. **Rate limiting**: The PI creation endpoint is throttled to 20/min.

10. **Subscription sync**: `customer.subscription.updated` properly handles both updates and new subscription creation from webhook events.
