# UX Failure Audit — Stripe Integration Frontend

**Date:** 2026-05-19
**Auditor:** Senior Product Architect
**Scope:** `apps/web/src/` — every user-facing component, action, hook, service, middleware, and provider.

---

## Summary Ratings

| Flow | Rating | Key Issue |
|------|--------|-----------|
| 1. Checkout — Card decline | **GOOD** | Excellent decline-code mapping, retry button |
| 1. Checkout — Network error during PI creation | **POOR** | Raw browser error messages shown to user |
| 1. Checkout — API error (500/503) | **ADEQUATE** | SDK-level errors handled well; API-level errors are raw |
| 2. Payment Method — Add | **GOOD** | Consistent error mapping, validation on client secret |
| 2. Payment Method — Detach default | **POOR** | No warning about consequences for subscriptions |
| 3. Subscription — Create | **BROKEN** | No subscription-creation UI path exists; plan links don't work |
| 3. Subscription — Cancel | **POOR** | No confirmation dialog; no immediate-cancel option |
| 3. Subscription — Expired | **ADEQUATE** | Status visible but no remedial action links |
| 4. Auth — Session expired | **POOR** | No automatic redirect to login; user stuck with error message |
| 4. Auth — 401 global | **POOR** | No global 401 interceptor for redirect |
| 5. Edge — Two tabs | **POOR** | No cross-tab synchronization |
| 5. Edge — Back button after payment | **GOOD** | Stripe consumed-secret handling works |
| 5. Edge — Refresh during payment | **ADEQUATE** | Redirect-based methods handled; one-time payment state lost |
| 5. Edge — Slow network | **ADEQUATE** | Loading skeletons everywhere; no timeout protection |

---

## 1. CHECKOUT FLOW

### 1.1 User journey: enter amount → select payment method → click Pay

**Code path:**

```
CheckoutPage (checkout/page.tsx)
  └── AmountEntryForm (AmountEntryForm.tsx)
        └── handleSubmit()
              └── createPaymentIntent() [action: payment-intents.ts]
                    └── apiClient.post('/payment-intents', body) [lib/api-client.ts]
                          └── fetch → ${API_URL}/api/v1/payment-intents
```

**Success path:**
- PI created → `clientSecret` set → step changes to `'payment'` → `StripeProvider` wraps `CheckoutForm` → `PaymentForm` renders Stripe `PaymentElement`

**Error table — PI creation failures (apiClient / server errors):**

| Error Scenario | HTTP Status | Code Path | User Sees | Retry Available? |
|----------------|-------------|-----------|-----------|------------------|
| Network down (fetch throws) | N/A | `handleSubmit catch` → `err.message` | Raw JS error like "Failed to fetch" or "NetworkError" | No (no retry button, must re-enter) |
| 401 (session expired) | 401 | `apiClient` tries refresh, fails → `ApiError('Session expired', 401)` | **"Session expired"** in red alert-error | No. User is stuck on checkout page with no login redirect. |
| 400 (validation) | 400 | `apiClient` → `ApiError(error.message)` | Whatever the server returns, e.g. "Amount must be positive" | No specific retry for validation |
| 500 (server error) | 500 | `apiClient` → `ApiError(error.message)` | Raw server message, e.g. "Internal server error" | No |
| 503 (Stripe/API down) | 503 | `apiClient` → `ApiError(error.message)` | Raw server message, e.g. "Service unavailable" | No |

**File:** `apps/web/src/app/checkout/page.tsx:42-52`
```typescript
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to create payment. Please try again.');
}
```

**Critical finding:** The `handleSubmit` catch block in `CheckoutPage` does NOT call `mapStripeError` or any friendly-message mapper. It passes through raw `err.message`. On the PI-creation step, the user sees raw technical errors. There is no retry button — the user must manually click "Continue to Payment" again, re-entering all form data each time.

**There is NO `onRecoverableError` / retry mechanism for the PI-creation step**, unlike the payment-confirmation step which has it in `CheckoutForm`.

---

### 1.2 User journey: payment confirmation (Stripe SDK)

**Code path:**

```
PaymentForm (PaymentForm.tsx)
  └── handleSubmit()
        └── stripe.confirmPayment({ elements, confirmParams, redirect: 'if_required' })
              └── if error → mapStripeError(error)
              └── if paymentIntent → mapPaymentIntentStatus(paymentIntent.status)
```

**Error table — Payment confirmation failures:**

| Scenario | SDK Error Type | Mapped Title | Mapped Message | Recoverability | Retry UI |
|----------|---------------|-------------|----------------|----------------|----------|
| Card declined (generic) | `card_error` | "Payment declined" | "Your bank declined the payment. No charge was made." | `recoverable` | "Try again" button (up to 3×) |
| Card declined (lost/stolen) | `card_error` + `lost_card` | "Payment method unavailable" | "[pm] has been flagged by your bank." | `non-recoverable` | "Please contact support." |
| Card declined (velocity) | `card_error` + `card_velocity_exceeded` | "Too many attempts" | "You have exceeded the number of attempts..." | `retry` | "Try again" button |
| Insufficient funds | `card_error` + `insufficient_funds` | "Insufficient funds" | "There are insufficient funds..." | `recoverable` | "Try again" button |
| Expired card | `card_error` + `expired_card` | "Expired card" | "Your card has expired. Please use a different card." | `recoverable` | "Try again" button |
| Incorrect CVC/number | `card_error` | "Incorrect card details" | "The card details you entered are incorrect." | `recoverable` | "Try again" button |
| Validation error | `validation_error` | "Invalid information" | "Please check your payment details..." | `recoverable` | "Try again" button |
| API connection (Stripe down) | `api_connection_error` | "Connection issue" | "We are having trouble connecting to our payment provider." | `retry` | "Try again" button |
| API internal error | `api_error` | "Payment service error" | "Our payment provider is experiencing issues." | `retry` | "Try again" button |
| Rate limited | `rate_limit_error` | "Too many attempts" | "You have made too many payment attempts..." | `retry` | "Try again" button (**no countdown/timer**) |
| Authentication error | `authentication_error` | "Payment configuration error" | "There is a configuration problem..." | `non-recoverable` | "Please contact support." |
| Secret consumed/expired | `invalid_request_error` | "Session expired" | "Your checkout session has expired or already been used." | `non-recoverable` | "Refresh the page to start a new checkout" |
| BNPL declined | `invalid_request_error` | "Payment declined" | "Your application for this payment method was declined." | `recoverable` | "Try again" button |
| Amount too large/small | `invalid_request_error` | "Amount exceeds limit" / "Amount too small" | Specific message about limits | `recoverable` | "Try again" button |
| Payment method unavailable | `invalid_request_error` | "Payment method unavailable" | "This payment method is not available..." | `recoverable` | "Try again" button |
| User cancelled (Apple/Google Pay sheet) | `abort` (runtime) | "Payment cancelled" | "You cancelled the payment." | `recoverable` | "Try again" button |
| Unexpected JS exception | `catch` clause | "Unexpected error" | `error.message` or "An unexpected error occurred." | `retry` | Explicit retry message in alert |

**Files:**
- `apps/web/src/components/stripe/PaymentForm.tsx:56-107` — error handling
- `apps/web/src/components/checkout/CheckoutForm.tsx:58-98` — error display with retry UI
- `apps/web/src/lib/stripe-errors.ts` — comprehensive mapping for all Stripe error types and decline codes

**Retry mechanism:**
- `CheckoutForm` tracks `errorCount`
- `isRecoverable = mapped.recoverability !== 'non-recoverable'`
- After 3 consecutive errors: retry button replaced with "Please contact support."
- **Good:** prevents rage-clicking through a broken payment flow

---

### 1.3 Payment success handling

**Code path after Stripe redirect or in-page success:**

```
/checkout/success/page.tsx
  └── useVerifyPayment()
        └── verifyPaymentIntent(paymentIntentId, redirectStatus) [action: payment-intent-verify.ts]
              └── apiClient.get('/payment-intents/stripe/:id')
              └── on 401: buildRedirectFallback(id, redirectStatus)
```

**Post-redirect verification failures:**

| Scenario | Result | User Sees |
|----------|--------|-----------|
| Session valid, PI succeeded | `succeeded` | Green checkmark, "Payment Successful" |
| Session valid, PI processing | `processing` | Green checkmark, "Payment Processing" |
| Session expired after redirect | `unknown` + redirect_status check | Amber warning, "Payment received" + message explaining session issue |
| No payment_intent in URL | `unknown` | "No payment information found in the URL." |
| API unreachable | `unknown` | "Unable to verify payment status. Please check your email." |

**File:** `apps/web/src/actions/payment-intent-verify.ts:24-31` — the `buildRedirectFallback` function gracefully handles the case where a Stripe redirect happens but the session doesn't survive. It checks the `redirect_status` query param (set by Stripe) to give a best-effort answer.

---

### 1.4 Specific HTTP status questions

**Q: 402 (card declined) — what message? Retry button?**
- Stripe does NOT use HTTP 402. Card declines come through the SDK (`stripe.confirmPayment` → `{ error: { type: 'card_error' } }`).
- `mapStripeError` + `mapDeclineError` provide detailed, actionable messages.
- **Retry button:** YES, for recoverable declines. After 3 errors, replaced with "Please contact support."
- **Rating: GOOD**

**Q: 429 (rate limited) — what message? Countdown?**
- SDK type: `rate_limit_error` → "Too many attempts" / "You have made too many payment attempts in a short time."
- **Countdown/timer:** NO. There is no dynamic countdown, no "try again in N seconds" message. Just a static "Try again" button.
- **Rating: ADEQUATE** — message is correct but no timing guidance.

**Q: 500 (server error) — what message?**
- During PI creation: raw server error message (e.g., "Internal server error").
- During payment confirmation (SDK): "Payment service error" / "Our payment provider is experiencing issues. No charge was made."
- **Rating: ADEQUATE** — SDK side is well-handled; PI creation side shows raw errors.

**Q: 503 (Stripe down) — what message?**
- SDK: "Connection issue" / "We are having trouble connecting to our payment provider. Please check your internet connection."
- This message conflates **Stripe being down** with **user's internet being down**. The text says "check your internet connection" even though Stripe's `api_connection_error` could be server-side.
- **Rating: ADEQUATE**

---

## 2. PAYMENT METHOD MANAGEMENT

### 2.1 Add new card

**Code path:**

```
PaymentMethodsPage (payment-methods/page.tsx)
  └── handleAddNew()
        └── createSetupIntent({ customerId }) [action: setup-intents.ts]
              └── apiClient.post('/setup-intents', input)
        └── On success: setupClientSecret set → <StripeProvider mode="setup">
              └── <SetupForm onSuccess / onError>
                    └── stripe.confirmSetup({ elements, redirect: 'if_required' })
```

**Error table:**

| Error Point | Handling | Rating |
|-------------|----------|--------|
| `createSetupIntent` API error | `catch` block in `handleAddNew` → `setSetupError({ title: 'Setup failed', message: msg })` | ADEQUATE |
| Invalid client secret prefix | `StripeProvider` validates `seti_` prefix, shows "Session error" + "Refresh the page" | GOOD |
| Stripe SDK errors (all types) | `mapStripeError()` → full mapping, same as PaymentForm | GOOD |
| SetupIntent status errors | `mapSetupIntentStatus()` → covers all statuses | GOOD |
| Unexpected exceptions | `SetupForm` catch → generic mapped error | GOOD |

**Client secret validation** (`apps/web/src/components/stripe/StripeProvider.tsx:33-39`):
```typescript
const validPrefix = mode === 'payment' ? 'pi_' : 'seti_';
if (!clientSecret.startsWith(validPrefix)) {
  setInitError(`Invalid checkout session. Expected ${validPrefix} secret, got: ${clientSecret.slice(0, 10)}...`);
}
```
This catches the case where a payment-mode PI is passed to a setup form (or vice versa).

**File:** `apps/web/src/app/payment-methods/page.tsx:93-101`

---

### 2.2 Set default — race condition with detach

**Code path:**
- `useSetDefaultPaymentMethod()` → `paymentMethodsService.setDefault(id)` → `PATCH /payment-methods/:id/default`
- `useDetachPaymentMethod()` → `paymentMethodsService.detach(id)` → `DELETE /payment-methods/:id/detach`
- Both invalidate `['payment-methods', customerId]` on success

**Race condition analysis:**

If a user clicks "Set default" and "Remove" in rapid succession:
1. Both mutations fire independently (no sequencing)
2. If detach completes first → card removed from Stripe
3. Then setDefault completes → 404 or error from API (card no longer exists)
4. Query cache invalidated twice — second invalidation fetches fresh state

**No optimistic update** — the UI doesn't immediately reflect the change. The "Default" badge appears only after refetch completes.

**No isLoading per-item** — both buttons share `isSettingDefault` and `isDetaching` globally. While one operation is pending, ALL items show disabled buttons.

**File:** `apps/web/src/app/payment-methods/page.tsx:171-184`

**Rating: ADEQUATE** — cache invalidation handles eventual consistency, but no per-item loading state.

---

### 2.3 Detach default payment method for active subscription

**Code path:**
- The "Remove" button is always visible and enabled (when not detaching).
- There is **no check** for whether this payment method is the default for an active subscription.
- There is **no warning dialog** ("This card is used for subscription X. Removing it may cause payment failures.")
- The API may reject the detach (server-side check), but the user won't know why.

**File:** `apps/web/src/app/payment-methods/page.tsx:183-187`

```typescript
<button
  onClick={() => detach({ id: pm.id, customerId })}
  disabled={isDetaching}
  className="btn-danger text-xs px-2 py-1"
>
  Remove
</button>
```

**Rating: POOR** — no proactive warning. User can silently break their subscription's payment flow.

---

## 3. SUBSCRIPTION MANAGEMENT

### 3.1 Create subscription

**This is the most critical finding in the audit.**

**The subscription creation flow is BROKEN.**

**What the UI shows:**
- Plans page (`subscriptions/page.tsx`) renders plan cards with a "Subscribe" button
- The button links to: `/checkout?priceId=${plan.stripePriceId}&amount=${plan.amount}&currency=${plan.currency}&customerId=${myCustomer.id}`

**What happens:**
1. User clicks "Subscribe" → navigates to `/checkout`
2. `CheckoutPage` renders — but it does **NOT read `priceId` or plan info from URL params**
3. User sees the `AmountEntryForm` where they must pick a payment method type and enter an amount manually
4. `createPaymentIntent()` is called — this creates a **one-time PaymentIntent**, NOT a subscription
5. There is **no call** to `subscriptionsService.create()` anywhere in the checkout or plans page

**The `useCreateSubscription` hook exists but is never called from any page component.**

**File:** `apps/web/src/features/subscriptions/subscriptions.hooks.ts:28-34`
```typescript
export function useCreateSubscription() {
  // ... defined but NEVER used in any page
}
```

**File:** `apps/web/src/app/subscriptions/page.tsx:125-133`
```html
<a href={`/checkout?priceId=${plan.stripePriceId}&amount=${plan.amount}&currency=${plan.currency}...`}>
  Subscribe
</a>
```
The URL params are passed but never consumed by the checkout page.

**Rating: BROKEN** — the "Subscribe" flow doesn't create subscriptions. Users can't subscribe to plans.

---

### 3.2 Cancel subscription

**Code path:**
- `SubscriptionCard` → "Cancel" button → `onUpdate({ id: sub.id, cancelAtPeriodEnd: true })`
- `useUpdateSubscription()` → `subscriptionsService.update(id, { cancelAtPeriodEnd: true })` → `PATCH /subscriptions/:id`

**Issues:**

1. **No confirmation dialog.** Click "Cancel" → immediately sets `cancelAtPeriodEnd: true`. No "Are you sure?" prompt.
   - **File:** `apps/web/src/app/subscriptions/page.tsx:85-93`

2. **Cancel type: at_period_end only.** There is no option for immediate cancellation. The `useCancelSubscription` hook exists in the hooks file but is **never called** from any page.
   - **File:** `apps/web/src/features/subscriptions/subscriptions.hooks.ts:40-46`

3. **No feedback after cancel.** After cancellation, no toast/success message. The badge changes to "(Cancels...)" on refetch.

4. **"Reactivate" button** — available when `cancelAtPeriodEnd === true`. Calls same `updateSub` with `cancelAtPeriodEnd: false`.

**Rating: POOR** — no confirmation dialog for destructive action.

---

### 3.3 Subscription expired / past due

**Status badges defined:**
- `active` → green
- `trialing` → blue
- `past_due` → yellow
- `incomplete` → yellow
- `unpaid` → orange
- `canceled` → red
- `paused` → gray

**File:** `apps/web/src/app/subscriptions/page.tsx:14-24`

**What's missing:**
- No "Update payment method" button/CTA for `past_due` or `unpaid` subscriptions
- No explanation of what `past_due` or `unpaid` means or what happens next
- No timeline/grace period information
- No link to the Billing Portal for resolving the issue (the "Billing Portal" button is at the top — not near the affected subscription)

**Rating: ADEQUATE** — status is visible, but no guided remediation path.

---

## 4. AUTH FLOW

### 4.1 Session expired during payment

**Code path (apiClient 401 handling):**

**File:** `apps/web/src/lib/api-client.ts:54-80`
```typescript
if (response.status === 401) {
  const refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, ...);
  if (refreshed.ok) {
    // retry original request with new cookies
  }
  // Refresh failed — session expired
  throw new ApiError('Session expired', 401);
}
```

**What happens per page when 401 is thrown:**

| Page / Component | Catch Handler | User Sees |
|-----------------|---------------|-----------|
| `CheckoutPage.handleSubmit()` | `catch` → `setError(err.message)` | "Session expired" in red alert-error. Stay on checkout. **No redirect.** |
| `CheckoutPage` (useMyCustomer) | React Query error | May redirect to `/account` if customerId is null |
| `PaymentForm.handleSubmit()` | The 401 would happen during PI creation (handled above), not during `confirmPayment` | — |
| `verifyPaymentIntent()` | Catches `ApiError` with status 401 → fallback | Uses `redirect_status` to give best answer |
| `PaymentMethodsPage` | React Query error for `useMyCustomer` → shows "Make a payment" prompt | No login redirect |
| `SubscriptionsPage` | React Query error | remains on page |

**Critical finding:** There is **no global 401 interceptor** that redirects to `/auth/login`. When a session expires:
- The user stays on the current page
- Sees an error message
- Has no obvious path to re-authenticate unless they manually navigate to login
- The `middleware.ts` only checks for cookie existence, not validity — an expired cookie still passes middleware

**File:** `apps/web/src/middleware.ts:24-29`
```typescript
if (!authToken) {
  const loginUrl = new URL('/auth/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}
```
This only catches the **absence** of a cookie. An expired cookie with the right name passes through.

**Rating: POOR** — no global 401 handler to redirect to login.

---

### 4.2 401 during any operation — redirect smoothness

**Auth pages themselves:**
- Login page: `useLogin()` → `authService.login()` → `POST /api/v1/auth/login`
- Register page: `useRegister()` → `authService.register()` → `POST /api/v1/auth/register`
- On error: `error.message` shown in `alert-error`. No specific handling for different error codes.
- Auth service: `apps/web/src/features/auth/auth.service.ts:12-18`
  ```typescript
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Auth failed');
  }
  ```

**Redirect after login:**
- `LoginPage` reads `redirect` query param, validates it's a relative path (prevents open redirect)
- **File:** `apps/web/src/app/auth/login/page.tsx:13`
  ```typescript
  const redirectTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  ```
- **Good:** open-redirect prevention

**Logout:**
- `Sidebar` → form action → `logoutAction()` server-side → deletes cookies → `redirect('/auth/login')`
- **File:** `apps/web/src/actions/auth.ts`

**Rating: ADEQUATE** — login/logout flow is correct but session-expiry handling is missing.

---

## 5. EDGE CASES

### 5.1 User opens two tabs

**What happens:**
- Both tabs share the same cookies (auth_token, refresh_token)
- Both tabs have independent React Query caches (in-memory, not shared)
- If Tab 1 cancels a subscription:
  - Tab 1: `invalidateQueries(['subscriptions'])` → refetches, reflects change
  - Tab 2: No awareness. The staleTime (60s) means the cache may serve stale data for up to 1 minute
  - Tab 2: On next interaction or tab refocus, `refetchOnWindowFocus: false` means no automatic refetch

**No cross-tab sync mechanism:**
- No BroadcastChannel API usage
- No `visibilitychange` listener to refetch data
- No WebSocket / SSE / polling
- `refetchOnWindowFocus: false` in `QueryClient` defaults

**File:** `apps/web/src/lib/query-client.ts:9`

**Rating: POOR** — two-tab scenario can lead to conflicting operations and stale data.

---

### 5.2 Browser back button after successful payment

**Path 1: In-page success (card payments, `redirect: 'if_required'`)**
- Success screen shown in `CheckoutForm` (client state: `succeeded === true`)
- User presses back → Next.js client-side navigation returns to checkout page
- Component re-mounts: `step === 'select'` (initial state), `clientSecret === null`
- User sees the amount-entry form again
- If they accidentally resubmit: new PI created, new payment attempted → no double-charge (new idempotency key)

**Path 2: Redirect-based success (3DS, bank auth)**
- After Stripe redirect, user lands on `/checkout/success?payment_intent=pi_xxx&redirect_status=succeeded`
- User presses back → goes to Stripe's hosted page or the previous app page
- If they navigate back to checkout: new checkout starts from scratch
- If they try to reuse the same PI: `confirmPayment` with consumed secret → `invalid_request_error` → "Session expired" with "Refresh the page to start a new checkout."

**Rating: GOOD** — Stripe's consumed-secret handling prevents double-payments. State reset is clean.

---

### 5.3 Browser refresh during payment processing

**In-page payment (card, no redirect):**
- User is on the PaymentForm, card details entered, clicks Pay
- `stripe.confirmPayment()` is in progress with `redirect: 'if_required'`
- User refreshes → entire page state lost (client-side `useState`)
  - `clientSecret`, `amount`, `currency` all reset
  - PI exists on Stripe but is orphaned
  - **No idempotency key in URL** — URL is just `/checkout`
  - User must start over

**Redirect payment (3DS, bank auth):**
- User is redirected to bank/3DS page
- If user refreshes the bank page → handled by Stripe/bank (out of scope)
- When redirected back to `/checkout/success?payment_intent=...&redirect_status=...`
  - `useVerifyPayment()` re-runs on mount
  - `verifyPaymentIntent()` server action fetches PI status
  - Works correctly — the PI ID is in the URL

**Rating: ADEQUATE** — redirect-based methods survive refresh; in-page flow is fragile.

---

### 5.4 Very slow network — loading states

**Loading state inventory:**

| Component | Loading State | Timeout? | Cancelable? |
|-----------|--------------|----------|-------------|
| `AmountEntryForm` submit | Button: "Creating payment..." disabled | No | No |
| `PaymentForm` submit | Button: spinner + "Processing..." disabled | No | Stripe handles internally |
| `SetupForm` submit | Button: spinner + "Saving..." disabled | No | No |
| `CheckoutPage` (customer load) | Full skeleton card with pulse | No | No |
| `PaymentMethodsPage` (list) | Skeleton rows with pulse | No | No |
| `SubscriptionsPage` (plans) | 3 skeleton cards | No | No |
| `SubscriptionsPage` (active subs) | 2 skeleton cards | No | No |
| `SuccessPage` (verify) | Spinner + "Verifying your payment..." | No | No |
| `AccountPage` | Skeleton card with pulse | No | No |
| `PaymentsPage` (list) | Skeleton rows | No | No |
| Stripe PaymentElement | `loader: 'auto'` (Stripe-branded skeleton) | Handled by Stripe | No |
| Global route loading | Skeleton layout (`loading.tsx`) | No | No |

**Issues:**

1. **No timeout anywhere.** If a fetch hangs indefinitely (e.g., server crashes mid-response), the user sees an eternal spinner with no "Cancel" or "Go back" option. The only escape is manual browser navigation.

2. **No cancellation for fetch operations.** AbortController is never used. The user cannot cancel a payment-in-progress.

3. **Stripe PaymentElement has its own error handling**, which is good — but the surrounding app doesn't handle a slow PI creation call gracefully.

4. **`apiClient` has no timeout.** `fetch()` calls have no `AbortSignal` or timeout wrapper.

**File:** `apps/web/src/lib/api-client.ts` — no timeout/abort mechanism

**Rating: ADEQUATE** — loading states exist everywhere but no timeout protection.

---

### 5.5 Additional edge cases discovered

**5.5.1 Checkout without customer**
- `CheckoutPage` checks `customerId` and redirects to `/account` if absent
- **File:** `apps/web/src/app/checkout/page.tsx:36-39`
- This is good — prevents creating PIs without a customer
- The redirect to `/account` makes sense (create a customer profile first)

**5.5.2 Idempotency key collision**
- `apiClient` generates UUID-based idempotency keys for every mutating request
- If the same key is reused with different body → Stripe returns `idempotency_error`
- `mapStripeError` handles this: "Duplicate request" / "This payment looks like a duplicate."
- **File:** `apps/web/src/lib/stripe-errors.ts:120-125`

**5.5.3 Payment methods page — no customer**
- Shows a message: "Payment methods are customer-specific. Make a payment to save a payment method."
- Link to `/checkout`
- **Rating: GOOD** — clear guidance

**5.5.4 CSS error/alert styles**
- `.alert-error` defined in `globals.css`: `bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm`
- `.alert-success`: `bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg text-sm`
- **Consistent styling** across all error states — good

---

## 6. FILE-BY-FILE REFERENCE

| File | Role | Error Handling Quality |
|------|------|----------------------|
| `lib/api-client.ts` | HTTP client, 401 refresh, idempotency | GOOD — auto-refresh, idempotency keys, cookie forwarding |
| `lib/stripe-errors.ts` | Error mapper for all Stripe types | EXCELLENT — comprehensive decline codes, BNPL, all payment types |
| `lib/stripe.ts` | Stripe.js singleton | ADEQUATE — throws on missing key, no fallback |
| `lib/query-client.ts` | React Query config | ADEQUATE — sensible defaults but refetchOnWindowFocus disabled |
| `actions/auth.ts` | Logout server action | GOOD — cookie cleanup, redirect |
| `actions/payment-intents.ts` | Create PI | ADEQUATE — delegates to apiClient, no custom error mapping |
| `actions/payment-intent-verify.ts` | Verify PI after redirect | EXCELLENT — 401 fallback, redirect_status checking |
| `actions/setup-intents.ts` | Create SetupIntent | ADEQUATE — delegates to apiClient |
| `actions/billing-portal.ts` | Billing portal session | ADEQUATE — delegates to apiClient |
| `app/checkout/page.tsx` | Checkout page orchestrator | POOR — raw error messages in PI creation catch |
| `app/checkout/error.tsx` | Checkout error boundary | ADEQUATE — generic "Checkout failed" with retry |
| `app/checkout/success/page.tsx` | Success page with verification | GOOD — handles all states including session expiry |
| `app/payment-methods/page.tsx` | Payment methods CRUD | GOOD — except missing detach-warning for subscription defaults |
| `app/subscriptions/page.tsx` | Subscription management | BROKEN — no subscription creation path |
| `app/error.tsx` | Global error boundary | ADEQUATE — error digest shown |
| `app/loading.tsx` | Global loading skeleton | GOOD |
| `components/checkout/CheckoutForm.tsx` | Checkout form with error/retry UI | GOOD — 3× retry counter, recoverable vs non-recoverable |
| `components/checkout/AmountEntryForm.tsx` | Amount + payment method selection | ADEQUATE — client-side validation only |
| `components/stripe/PaymentForm.tsx` | Stripe PaymentElement wrapper | GOOD — comprehensive error mapping |
| `components/stripe/SetupForm.tsx` | Stripe SetupIntent form | GOOD — same error quality as PaymentForm |
| `components/stripe/StripeProvider.tsx` | Stripe Elements context | GOOD — client secret validation |
| `components/payments/PaymentHistoryPreview.tsx` | Payment history widget | GOOD — handles all states (loading, empty, error) |
| `components/layout/Sidebar.tsx` | Navigation + logout | GOOD — form action logout |
| `features/auth/auth.hooks.ts` | Auth mutations | ADEQUATE — thin wrapper |
| `features/auth/auth.service.ts` | Auth API calls | ADEQUATE — bypasses apiClient correctly |
| `features/customers/customers.hooks.ts` | Customer queries/mutations | GOOD — handles 404 gracefully |
| `features/payment-methods/*` | PM hooks/service/types | ADEQUATE — cache invalidation OK |
| `features/payment-intents/*` | PI hooks/service/types | ADEQUATE — pagination with keepPreviousData |
| `features/subscriptions/subscriptions.hooks.ts` | Subscription mutations | ADEQUATE — useCreateSubscription unused in UI |
| `middleware.ts` | Route protection | ADEQUATE — cookie presence check, no validity check |

---

## 7. CRITICAL FIXES REQUIRED

### P0 (Blocking user goals):

1. **Subscription creation is broken.** The "Subscribe" button links to checkout which creates a PaymentIntent, not a Subscription. Implement the actual subscription creation flow using `useCreateSubscription()`.

### P1 (Severely degraded UX):

2. **No global 401 redirect.** When a session expires mid-operation, users see a cryptic error and must manually find their way to login. Add a 401 interceptor that redirects to `/auth/login?redirect=<current>`.

3. **Raw error messages during PI creation.** `CheckoutPage.handleSubmit()` catch block shows raw `err.message`. Wrap in friendly error mapping consistent with Stripe SDK errors.

4. **No timeout on any fetch.** Add AbortController with 30s timeout to `apiClient`, with retry UIs that let users cancel stuck operations.

### P2 (Should fix):

5. **Missing confirmation dialog for subscription cancel.** Add a confirmation step before setting `cancelAtPeriodEnd: true`.

6. **No warning on detaching default payment method.** Check if PM is default for any active subscription; warn user before detaching.

7. **Rate-limit error has no countdown.** Add a dynamic retry timer for `rate_limit_error`.

8. **No cross-tab synchronization.** Add BroadcastChannel or enable `refetchOnWindowFocus` for critical pages.

9. **`api_connection_error` message conflates user internet with server outage.** Improve the messaging to distinguish these cases.

---

## 8. WHAT WORKS WELL

1. **Stripe error mapping is exceptional** — `stripe-errors.ts` handles every decline code, BNPL rejections, wallet cancellations, and edge cases with user-friendly, actionable messages.

2. **Success page gracefully handles session expiry after redirect** — `verifyPaymentIntent` fallback to `redirect_status` is a thoughtful touch.

3. **Idempotency key generation on every mutation** — prevents double-charges from network retries.

4. **Retry counter in CheckoutForm** — limits to 3 attempts then shows support contact.

5. **Client secret prefix validation** in StripeProvider — catches misconfigurations early.

6. **Open-redirect prevention** in login redirect handling.

7. **Consistent alert-error styling** across all components.

8. **Loading skeletons** on all data-fetching pages — no blank screens.
