# Compliance & Idempotency Audit Report

**Date:** 2026-05-19  
**Auditor:** Security & Governance Architect  
**Scope:** Full codebase — backend (NestJS/Oracle), frontend (Next.js), shared types  
**Severity Legend:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## EXECUTIVE SUMMARY

6 critical findings, 7 high-severity findings, 8 medium-severity findings.

**Critical issues:**
1. Subscription creation has no idempotency-key deduplication at the database layer — double-subscription risk
2. `PaymentForm` crash after Stripe `confirmPayment` success → user may be double-charged on retry
3. User account deletion does not exist — GDPR Article 17 violation
4. Customer `softDelete` retains PII permanently — GDPR violation
5. Payment methods are hard-deleted — no audit trail, GDPR access gap
6. No idempotency key TTL — unbounded storage growth, potential replay/brute-force surface

---

## 1. IDEMPOTENCY KEY COVERAGE

### 1.1 Endpoints WITH Idempotency Key Support ✅

| Endpoint | Method | Decorator | Repository Check |
|---|---|---|---|
| `/payment-intents` | POST | `@IdempotencyKey()` | `PaymentIntentsRepository.findByIdempotencyKey()` |
| `/payment-intents/:id` | PATCH | `@IdempotencyKey()` | N/A (update operation) |
| `/customers` | POST | `@IdempotencyKey()` | `CustomersRepository.findByIdempotencyKey()` |
| `/customers/:id` | PATCH | `@IdempotencyKey()` | N/A (update operation) |
| `/subscriptions` | POST | `@IdempotencyKey()` | ⚠️ NO repository check (see §2.1) |
| `/subscriptions/:id` | PATCH | `@IdempotencyKey()` | N/A (update operation) |
| `/setup-intents` | POST | `@IdempotencyKey()` | `SetupIntentsRepository.findByIdempotencyKey()` |

### 1.2 Endpoints MISSING Idempotency Key Support 🔴🟠

#### 🔴 CRITICAL: `POST /payment-methods/:id/set-default/customer/:customerId`
- **File:** `apps/api/src/payment-methods/payment-methods.controller.ts:56`
- **Risk:** Network retry could trigger `clearDefaultByCustomer()` followed by `setDefault()`. A second concurrent call could leave NO default payment method set.
- **Fix:** Add `@IdempotencyKey()` decorator and an idempotency check in the service method.

#### 🟠 HIGH: `POST /customers/:id/billing-portal`
- **File:** `apps/api/src/customers/customers.controller.ts:78`
- **Risk:** Stripe billing portal sessions are short-lived (typically 24h). Double-creation on retry wastes a Stripe API call and returns a stale session URL. Not a financial risk, but a user experience and resource waste issue.
- **Fix:** Add `@IdempotencyKey()` decorator.

#### 🟠 HIGH: `POST /customers/:id/customer-sessions`
- **File:** `apps/api/src/customers/customers.controller.ts:68`
- **Risk:** Same as billing portal — Stripe Customer Session created twice on retry. The second session's clientSecret won't match the PaymentElement already mounted, causing a confusing UX error.
- **Fix:** Add `@IdempotencyKey()` decorator.

#### 🟡 MEDIUM: `POST /customers/:id/sync`
- **File:** `apps/api/src/customers/customers.controller.ts:89`
- **Risk:** Read-after-write idempotent operation (syncs from Stripe). Multiple invocations yield the same result. Low risk.
- **Fix:** Add `@IdempotencyKey()` for consistency.

#### 🟡 MEDIUM: `POST /subscriptions/plans/sync`
- **File:** `apps/api/src/subscriptions/subscriptions.controller.ts:47`
- **Risk:** Admin-only cache invalidation. Harmless if called multiple times. Low risk.
- **Fix:** Low priority; idempotent by nature.

#### 🟡 MEDIUM: `POST /auth/register`
- **File:** `apps/api/src/auth/auth.controller.ts:55`
- **Risk:** On network retry, two accounts could be created with the same email (currently caught by `UNIQUE(EMAIL)` constraint — so the second call returns 409 Conflict, which is acceptable). The Stripe customer won't be double-created because customer creation happens separately in the payment flow.
- **Fix:** Low priority given UNIQUE constraint. Add idempotency key for defense-in-depth.

#### 🟡 MEDIUM: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- **Files:** `apps/api/src/auth/auth.controller.ts:63,76,89`
- **Risk:** Login/refresh/logout generate new JWT tokens. If login is retried, the user gets a new token pair; the old one is orphaned. Not a security risk (tokens expire). Logout retry with an already-revoked token is a no-op.
- **Fix:** Low priority; these are naturally idempotent or have acceptable side effects.

### 1.3 GET/DELETE Endpoints With Idempotency Keys ⚠️

#### 🟡 MEDIUM: Frontend `apiClient.delete()` sends idempotency key
- **File:** `apps/web/src/lib/api-client.ts:133`
- **Issue:** The `delete()` method calls `generateIdempotencyKey()`. DELETE is idempotent by HTTP spec. While the backend ignores the header for DELETE endpoints, this wastes resources and adds unnecessary headers.
- **Fix:** Remove `generateIdempotencyKey()` from the `delete` method.

#### ✅ CORRECT: GET endpoints do NOT send idempotency keys
- `apiClient.get()` correctly omits the idempotency key — confirmed.

---

## 2. IDEMPOTENCY KEY STORAGE & DEDUPLICATION GAPS

### 2.1 🔴 CRITICAL: Subscriptions Service Has No Idempotency-Key Dedup

- **File:** `apps/api/src/subscriptions/subscriptions.service.ts:42-92`
- **Repository:** `apps/api/src/subscriptions/subscriptions.repository.ts` — no `findByIdempotencyKey()` method
- **Schema:** `STRIPE_SUBSCRIPTIONS` table has NO `IDEMPOTENCY_KEY` column (confirmed in migration 001)

**What happens:**
1. Client calls `POST /subscriptions` with `Idempotency-Key: abc-123`
2. Controller passes `idempotencyKey` to `SubscriptionsService.create()`
3. Service checks `findActiveByCustomerAndPrice()` — this is a BUSINESS-LOGIC dedup (same customer + same price), NOT idempotency-key dedup
4. Service creates Stripe subscription via `stripeService.subscriptions.create()` passing the idempotency key to Stripe
5. Stripe deduplicates by its own key
6. Service queries `findByStripeId()` to check if already saved (this catches Stripe-level dedup)
7. If Stripe returns the cached subscription but the DB was never inserted, step 6 catches it

**BUT:** If two requests arrive with the same idempotency key BEFORE Stripe processes either one:
- Request A: passes `findActiveByCustomerAndPrice` check (no active sub) → calls Stripe
- Request B: passes `findActiveByCustomerAndPrice` check (still no active sub in DB) → calls Stripe with SAME idempotency key
- Stripe deduplicates and returns the same subscription object for both
- Request A: `findByStripeId` → not found → inserts DB record → returns
- Request B: `findByStripeId` → FOUND → returns the same subscription → **NO double-charge**

✅ **Stripe-level idempotency saves us here.** But this is fragile — it relies on Stripe's idempotency layer, not our own.

**Real risk:** If `idempotencyKey` is NOT passed to Stripe (code regression, refactor), we get double subscriptions.

**Fix:**
1. Add `IDEMPOTENCY_KEY VARCHAR2(255)` column to `STRIPE_SUBSCRIPTIONS`
2. Add `findByIdempotencyKey()` to `SubscriptionsRepository`
3. Add idempotency-key lookup BEFORE the Stripe API call in `SubscriptionsService.create()`
4. Store the idempotency key in the `insert()` call
5. Create migration with index: `CREATE INDEX IDX_SUB_IDEMPOTENCY ON STRIPE_SUBSCRIPTIONS(IDEMPOTENCY_KEY)`

### 2.2 🔴 CRITICAL: No Idempotency Key TTL — Unbounded Storage

- **Affected tables:** `STRIPE_CUSTOMERS`, `STRIPE_PAYMENT_INTENTS`, `STRIPE_SETUP_INTENTS`
- **No cleanup mechanism exists anywhere.**

**Risks:**
- **Storage growth:** Each mutation creates one idempotency key record. Over years, tens of millions of keys accumulate.
- **Replay attack surface:** If an attacker obtains a valid idempotency key from logs/network traces, they can replay it indefinitely (keys never expire).
- **Brute-force enumeration:** An attacker can POST random UUIDs to any endpoint and check if they get a cached response vs. a new resource — information leakage about past transaction volumes.

**Fix:**
1. Add `IDEMPOTENCY_KEY_EXPIRES_AT TIMESTAMP` column to all three tables
2. Set TTL to 24 hours (standard Stripe idempotency window)
3. Add a scheduled job to purge expired keys (set `IDEMPOTENCY_KEY = NULL` where `IDEMPOTENCY_KEY_EXPIRES_AT < SYSDATE`)
4. Add `WHERE IDEMPOTENCY_KEY_EXPIRES_AT > SYSDATE` to all `findByIdempotencyKey` queries

### 2.3 🟠 HIGH: Key Reuse After Original Record Deletion

- **Files:** `CustomersRepository.findByIdempotencyKey()`, `PaymentIntentsRepository.findByIdempotencyKey()`
- **Scenario:** Customer record created with idempotency key X → later soft-deleted → new customer creation sends the same key X (vanishingly unlikely with UUIDs, but possible if clients reuse keys or if UUID collision occurs).
- **Customer:** `findByIdempotencyKey` returns the soft-deleted customer. `findActiveByEmail` then catches the duplicate email and throws `ConflictException`. But if email is different, the old customer is returned — this creates a data integrity issue (wrong customer returned).
- **PaymentIntent:** `findByIdempotencyKey` returns the old PI regardless of status. This could return a previously-canceled PI instead of creating a new one.

**Fix:**
1. Add `AND IS_DELETED = 0` to `CustomersRepository.findByIdempotencyKey()`
2. Add status filter to `PaymentIntentsRepository.findByIdempotencyKey()` (return only if status is `requires_payment_method` or `processing` — not `canceled` or `succeeded`)

### 2.4 🟠 HIGH: Frontend `subscriptions.service.ts` Sends Double Idempotency Keys

- **File:** `apps/web/src/features/subscriptions/subscriptions.service.ts:17-22`
- **Issue:** 
  ```typescript
  create(data: CreateSubscriptionInput): Promise<Subscription> {
    return apiClient.post('/subscriptions', data, { 'Idempotency-Key': crypto.randomUUID() });
  }
  ```
  `apiClient.post()` already generates an idempotency key via `generateIdempotencyKey()`. The explicit header is then OVERWRITTEN by the auto-generated one inside `request()`. The explicit `crypto.randomUUID()` call is wasted and misleading.

**Fix:** Remove the explicit headers from `subscriptions.service.ts` and let `apiClient.post()/patch()` auto-generate.

---

## 3. DOUBLE-CHARGE SCENARIO ANALYSIS

### 3.1 🔴 CRITICAL: Stripe `confirmPayment` Success + App Crash → User Retries → Double Charge

**Flow:**
1. User enters checkout → `createPaymentIntent` (backend) → PI created, status = `requires_payment_method`
2. User submits PaymentForm → `stripe.confirmPayment()` called
3. **Stripe processes the payment successfully** (card charged, PI status → `succeeded`)
4. **Browser/app crashes BEFORE the success callback fires** (JS exception, power loss, tab close, mobile app kill)
5. User reopens app, goes to checkout, creates a NEW PaymentIntent, pays again → **CHARGED TWICE**

**Key gap:** The `CheckoutForm` (and `PaymentForm`) has no mechanism to detect that a payment was already processed for this purchase. Each checkout session creates a fresh PaymentIntent.

**Files involved:**
- `apps/web/src/app/checkout/page.tsx:52-68` — `handleSubmit` creates new PI unconditionally
- `apps/web/src/components/stripe/PaymentForm.tsx:69-119` — `handleSubmit` calls `stripe.confirmPayment`
- `apps/web/src/components/checkout/CheckoutForm.tsx:31-74` — success handler, no "existing payment" check

**Fix:**
1. Store an `orderId` or `cartId` in sessionStorage/localStorage before creating the PaymentIntent
2. After `stripe.confirmPayment` succeeds, mark the order as "paid" in localStorage
3. On checkout page mount, check localStorage for a "paid" order and redirect to success page
4. On the backend, accept an optional `orderId`/`idempotencyKey` in `CreatePaymentIntentDto` to enable same-order dedup

### 3.2 🟠 HIGH: Network Timeout During `createPaymentIntent` → Client Retry

**Current protection:** ✅ `apiClient.post()` generates an idempotency key, and retries (401 refresh path) reuse the same key. The backend checks `findByIdempotencyKey()` before calling Stripe.

**Partial gap:** The `request()` function's 401-retry path reconstructs headers:
```typescript
const retried = await fetch(`${API_URL}/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...baseHeaders, ...(await getCookieHeader()) },
    cache: 'no-store',
});
```
This preserves `Idempotency-Key` in `baseHeaders`. ✅ Correct.

BUT: If the error is a 5xx (server error) — NOT 401 — the api-client throws an `ApiError` immediately. The calling code in `CheckoutPage.handleSubmit` catches this and shows an error. The user must manually retry, which generates a NEW idempotency key → creates a new PaymentIntent (since the old one likely succeeded despite the 5xx, or failed — we don't know).

**Fix:**
1. Add automatic retry for 5xx errors in `apiClient.request()` (with exponential backoff, max 3 retries)
2. Ensure the same idempotency key is used across automatic retries

### 3.3 🟡 MEDIUM: ALB Retry on 5xx

**Protection:** ✅ The idempotency key decorator extracts the header, and the service checks `findByIdempotencyKey()` first. ALB retries preserve headers, so the same key is seen. The cached result is returned.

**No gap here** — this is correctly handled.

### 3.4 🟠 HIGH: Webhook Payment Confirmation → DB Update → Silent Failure

**File:** `apps/api/src/webhooks/handlers/payment-intent.handler.ts:15-64`

```typescript
case 'payment_intent.succeeded':
    await this.paymentIntentsService.updateStatus(pi.id, 'succeeded');
    break;
```

**What happens:** `updateStatus()` calls `findByStripeId()` → if PI not found in our DB → returns silently:
```typescript
async updateStatus(...): Promise<void> {
    const pi = await this.findByStripeId(stripePaymentIntentId);
    if (!pi) return; // SILENT RETURN — no error, no alert, no retry
    ...
}
```

**Scenario:** PaymentIntent created in Stripe via API but DB insert fails → PI is canceled in catch block → webhook for `payment_intent.canceled` arrives → `updateStatus` finds nothing → silently returns. This is actually correct behavior (no orphan).

**BUT the real scenario:** PI created and paid OUTSIDE our system (directly via Stripe Dashboard, or via another integration). Webhook arrives. `updateStatus` silently returns. Our DB never knows about this payment. The user sees no record.

**This is intentional design** — we only track PIs created through our API. But it means:
- No cross-system reconciliation
- If the `create()` method's DB insert fails AFTER Stripe creation, the webhook won't help recover

**Fix:**
1. Log a warning when `updateStatus` finds no PI: "Webhook received for unknown PI — may indicate external creation or DB insert failure"
2. Consider creating the DB record from the webhook if it doesn't exist (defense-in-depth)

### 3.5 Mobile App Specific: App Crash During Payment Flow

Same as §3.1 — the `stripe.confirmPayment()` crash scenario applies equally to mobile. Additionally on mobile:

**Gap:** Mobile apps typically use `return_url` for redirect-based payment methods (3DS, bank redirects). The `redirect: 'if_required'` in PaymentForm handles this for standard cards, but bank-based methods (iDEAL, Sofort) require a redirect. If the app is killed during the redirect flow:
1. Bank authorizes the payment
2. Stripe redirects back to `return_url` (`/checkout/success`)
3. App is dead → redirect never reaches our code
4. The `/checkout/success` page calls `verifyPaymentIntent` — but never runs
5. Webhook eventually updates our DB
6. User has no immediate feedback

**Fix:** The `checkout/success` page handles this partially via `verifyPaymentIntent`. But ensure the page also works cold (direct navigation, no prior state).

---

## 4. COMPLIANCE

### 4.1 PCI DSS — Card Data Exposure

#### 4.1.1 🟠 HIGH: `sanitizeFields` Missing PCI-Specific Fields

- **File:** `apps/api/src/logging/sanitize.ts:3-9`

```typescript
const SENSITIVE = new Set([
  'password', 'token', 'authorization', 'ssn', 'creditcard', 'secret',
  'apikey', 'api_key', 'refreshtoken', 'refresh_token',
  'stripesecretkey', 'stripe_secret_key', 'webhooksecret', 'webhook_secret',
  'jwtsecret', 'jwt_secret', 'databaseurl', 'database_url',
  'redisurl', 'redis_url', 'privatekey', 'private_key',
]);
```

**Missing PCI fields:** `cvc`, `cvv`, `pan`, `cardnumber`, `card-number`, `cc-number`, `expiry`, `expiration`, `card`, `billing_details`, `payment_method`

While Stripe handles actual card numbers (they never reach our server), the `billing_details` object can contain PII (name, address, phone). Stripe PaymentMethod objects include `billing_details` in their JSON.

**Fix:** Add to `SENSITIVE`: `'card'`, `'billing_details'`, `'billingdetails'`, `'cvc'`, `'cvv'`, `'pan'`, `'cardnumber'`, `'expiry'`

#### 4.1.2 🟡 MEDIUM: Stripe Error Messages Could Contain Card Metadata

- **Files:**
  - `apps/api/src/payment-intents/payment-intents.service.ts:85-90`
  - `apps/api/src/setup-intents/setup-intents.service.ts:56-60`

```typescript
this.logger.error({
    message: 'Stripe PaymentIntent creation failed',
    stripeError: stripeError instanceof Error ? stripeError.message : String(stripeError),
});
```

Stripe error messages do NOT contain full card numbers, but they DO contain:
- `decline_code` (e.g., `insufficient_funds`, `do_not_honor`)
- Last 4 digits may appear in certain error descriptions

**Assessment:** This is low-risk because Stripe intentionally excludes PAN from error messages. But it's worth sanitizing to be safe.

**Fix:** Use `mapStripeError()` or a dedicated sanitizer before logging Stripe errors. At minimum, redact any 13-19 digit sequences.

#### 4.1.3 ✅ COMPLIANT: No Raw Card Data in Database

- Card data stored: `last4` (truncated), `brand` (e.g., "visa"), `exp_month`, `exp_year`, `fingerprint` (Stripe-generated hash)
- These are all PCI-compliant truncated/tokenized fields
- No CVV, full PAN, or magstripe data stored

### 4.2 GDPR — Right to Erasure (Article 17)

#### 4.2.1 🔴 CRITICAL: User Account Deletion Does Not Exist

- **File:** `apps/api/src/auth/users.repository.ts` — no delete/softDelete method
- **Controller:** `apps/api/src/auth/auth.controller.ts` — no DELETE endpoint
- **Entity:** `apps/api/src/entities/user.entity.ts` — no `IS_DELETED` column

**GDPR Article 17 requires data subjects have the right to erasure of their personal data.** Currently:
- User email and password hash are permanently stored
- No way for a user to delete their account
- No way for an admin to delete a user account

**Fix:**
1. Add `IS_DELETED NUMBER(1) DEFAULT 0` to `APP_USERS` table
2. Add `DELETE /auth/account` endpoint
3. On account deletion:
   - Soft-delete the user record
   - Soft-delete the associated customer record
   - Cancel all active subscriptions
   - Detach all payment methods from Stripe
   - Anonymize email (set to `deleted-{uuid}@deleted.example.com`)
   - Clear password hash
4. Implement a 30-day grace period before permanent anonymization (GDPR allows reasonable retention for legal obligations)

#### 4.2.2 🔴 CRITICAL: Customer `softDelete` Retains PII Permanently

- **File:** `apps/api/src/customers/customers.repository.ts:80-83`

```typescript
async softDelete(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET IS_DELETED = 1, UPDATED_AT = SYSDATE WHERE ID = :1`,
      [id],
    );
}
```

**Problem:** Email, name, phone, and metadata are preserved indefinitely. `IS_DELETED = 1` only hides the record from queries — the data is still present and could be restored.

**GDPR requirement:** Personal data must be erased, not just hidden.

**Fix:** In `softDelete`, overwrite PII fields:
```sql
UPDATE STRIPE_CUSTOMERS SET 
  EMAIL = 'deleted-' || ID || '@deleted.example.com',
  NAME = NULL,
  PHONE = NULL,
  METADATA = NULL,
  IS_DELETED = 1,
  UPDATED_AT = SYSDATE 
WHERE ID = :1
```

#### 4.2.3 🔴 CRITICAL: Payment Methods Are Hard-Deleted

- **File:** `apps/api/src/payment-methods/payment-methods.repository.ts:68-72`

```typescript
async deleteById(id: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
      [id],
    );
}
```

**Dual problem:**
1. **GDPR audit trail gap:** Hard delete removes the evidence that a payment method ever existed. Under GDPR, the organization must demonstrate that data was properly handled. A hard delete without an audit trail is problematic.
2. **No soft-delete fallback:** If a bug causes incorrect deletion, data is permanently lost. There's no way to undo.

**Fix:**
1. Change to soft delete: `UPDATE STRIPE_PAYMENT_METHODS SET IS_DELETED = 1`
2. Clear last4, brand, exp_month, exp_year, fingerprint, billing_details on soft delete
3. Keep stripePaymentMethodId and type (non-PII) for audit purposes

#### 4.2.4 🟠 HIGH: No Bulk User Data Export (GDPR Article 15/20)

- There is no endpoint to export all data associated with a user.
- GDPR Article 15 (Right of Access) and Article 20 (Data Portability) require this.
- Related data: user record, customer record, payment intents, subscriptions, payment methods, audit logs.

**Fix:** Add `GET /auth/account/export` endpoint that returns a machine-readable JSON export of all user data.

#### 4.2.5 🟠 HIGH: Webhook Payloads Contain PII — Encryption But No Deletion

- **File:** `apps/api/src/crypto/encryption.service.ts` — AES-256-GCM encryption of payloads ✅
- **File:** `apps/api/src/webhooks/webhooks.repository.ts` — no delete/purge method

**Problem:** Encrypted webhook payloads contain full PII (customer name, email, address, payment method details). They persist forever in `STRIPE_WEBHOOK_EVENTS.PAYLOAD`. No TTL, no purge mechanism.

**Fix:**
1. Add `RETENTION_DATE TIMESTAMP DEFAULT SYSDATE + 90` to `STRIPE_WEBHOOK_EVENTS`
2. Add scheduled job to NULL/delete `PAYLOAD` column where `RETENTION_DATE < SYSDATE` and status = 'processed'
3. Keep event metadata (event ID, type, status, created_at) for audit purposes

### 4.3 Hard Deletes vs Soft Deletes — Complete Inventory

| Table | Delete Type | GDPR Compliant? |
|---|---|---|
| `APP_USERS` | ❌ NONE — no delete exists | No |
| `STRIPE_CUSTOMERS` | ✅ Soft delete (`IS_DELETED = 1`) | No — PII retained |
| `STRIPE_PAYMENT_INTENTS` | ❌ NONE — cancel only (status change) | Yes — no PII to erase* |
| `STRIPE_SETUP_INTENTS` | ❌ NONE — cancel only (status change) | Yes — no PII to erase* |
| `STRIPE_SUBSCRIPTIONS` | ❌ NONE — cancel only (status change) | Yes — no PII to erase* |
| `STRIPE_PAYMENT_METHODS` | ❌ **Hard delete** | No — should be soft delete |
| `STRIPE_WEBHOOK_EVENTS` | ❌ NONE | No — PII in payloads |
| `AUDIT_LOGS` | ✅ Auto-purge (RETENTION_DATE + 90) | Yes |

*PaymentIntents, SetupIntents, and Subscriptions reference `customerId` and may contain `receiptEmail` or `description` with PII. See §4.3.1.

#### 4.3.1 🟡 MEDIUM: PaymentIntents Have `receiptEmail` PII

- **File:** `apps/api/src/entities/stripe-payment-intent.entity.ts:75`
- `receiptEmail` is stored in `STRIPE_PAYMENT_INTENTS` and is never cleared on cancellation
- GDPR: this is PII and should be cleared when the customer is deleted

**Fix:** Clear `receiptEmail` when customer is soft-deleted. Add cascade anonymization.

### 4.4 SOC2 — Audit Trail

#### 4.4.1 ✅ COMPLIANT: Audit Logging Exists

- **Files:** `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.decorator.ts`, `apps/api/src/common/interceptors/audit.interceptor.ts`
- **Coverage:** All mutating endpoints (create, update, cancel, delete) have `@Audit()` decorators
- **Retention:** 90 days, with `RETENTION_DATE` index for purging

#### 4.4.2 🟡 MEDIUM: No Automated Audit Log Purge

- **File:** `apps/api/src/database/migrations/008-create-audit-logs.ts:49` — `RETENTION_DATE` column exists
- **But:** No scheduled job to actually purge expired records
- **Fix:** Add a cron job: `DELETE FROM AUDIT_LOGS WHERE RETENTION_DATE < SYSDATE`

#### 4.4.3 🟡 MEDIUM: Missing `@Audit()` on Some Endpoints

The following POST/PATCH/DELETE endpoints are missing `@Audit()`:
- `POST /auth/register` — user creation
- `POST /auth/login` — authentication event
- `POST /auth/refresh` — token rotation
- `POST /customers/:id/customer-sessions` — session creation
- `POST /customers/:id/billing-portal` — portal access
- `POST /customers/:id/sync` — data sync
- `POST /payment-methods/:id/set-default` — default change
- `POST /subscriptions/plans/sync` — cache refresh

**Fix:** Add `@Audit()` decorators to all mutating endpoints.

---

## 5. ADDITIONAL SECURITY FINDINGS

### 5.1 🟠 HIGH: `encryption.key` Not Enforced in Production

- **File:** `apps/api/src/crypto/encryption.service.ts:30-34`

```typescript
if (!raw) {
    this.logger.warn(
        'ENCRYPTION_KEY not set — webhook payloads will be stored as plaintext. ' +
        'Set this before handling real customer data.',
    );
    return;
}
```

**Risk:** If `ENCRYPTION_KEY` is forgotten in production deployment, ALL webhook payloads (containing full PII) are stored as plaintext CLOBs in Oracle. This is a GDPR-reportable data breach if the database is ever accessed without authorization.

**Fix:**
1. Throw a fatal error (prevent app startup) if `ENCRYPTION_KEY` is missing AND `NODE_ENV === 'production'`
2. Add a health check that verifies encryption is active

### 5.2 🟡 MEDIUM: `sanitizeFields` Never Called in Production Path

- **File:** `apps/api/src/logging/sanitize.ts`
- **Usage:** The `sanitizeFields` and `maskEmail` functions are defined but searching the entire codebase reveals they are NEVER called in any service, controller, or interceptor.

**Every `logger.log()` call passes raw request/response data directly.** For example:
```typescript
this.logger.log({
    message: 'PaymentIntent created and saved',
    stripePaymentIntentId: stripePI.id,
    amount: stripePI.amount,
    currency: stripePI.currency,
    customerId: internalCustomerId ?? 'guest',
});
```
This is fine (no PII), but the sanitization infrastructure exists and isn't wired in.

**Fix:** Wire `sanitizeFields` into a global NestJS logger or interceptor. At minimum, use `maskEmail()` when logging email addresses.

### 5.3 🟡 MEDIUM: `IDEMPOTENCY_KEY` Column Is Nullable Without Business Reason

- **Tables:** `STRIPE_CUSTOMERS`, `STRIPE_PAYMENT_INTENTS`, `STRIPE_SETUP_INTENTS`
- **All three tables have `IDEMPOTENCY_KEY VARCHAR2(255) NULL`**
- Every create flow passes an idempotency key (it's required by the controller decorator)
- The column is only NULL for records created by webhook sync handlers

**Fix:** Add a comment documenting that NULL idempotency keys indicate webhook-created records. Consider using a sentinel value like `'WEBHOOK_SYNC'` instead of NULL for auditability.

### 5.4 🟢 LOW: Race Condition in PaymentIntent Ownership Check

- **File:** `apps/api/src/payment-intents/payment-intents.controller.ts:109-113`

```typescript
private async assertPaymentIntentOwnership(pi: StripePaymentIntent, userId: string): Promise<void> {
    if (!pi.customerId) throw new ForbiddenException('Access denied');
    const customer = await this.customersService.findById(pi.customerId);
    if (!customer) throw new NotFoundException(`Customer not found`);
    if (customer.userId !== userId) throw new ForbiddenException('Access denied');
}
```

There's a TOCTOU race: `findById(id)` returns the PI, then `findById(pi.customerId)` fetches the customer. Between these two calls, the customer could be reassigned. However, customers are immutable after creation (no user reassignment), so this is low risk.

---

## 6. FIX PRIORITIZATION ROADMAP

### Immediate (P0 — 1-2 days)
1. Add idempotency-key dedup to SubscriptionsService (§2.1)
2. Add `Idempotency-Key` to `POST /payment-methods/:id/set-default` (§1.2)
3. Implement user account deletion (§4.2.1)
4. Anonymize PII on customer softDelete (§4.2.2)
5. Enforce ENCRYPTION_KEY in production (§5.1)
6. Add localStorage "already paid" check in CheckoutForm (§3.1)

### Short-term (P1 — 1 week)
7. Add idempotency key TTL and purge job (§2.2)
8. Change payment-methods to soft delete (§4.2.3)
9. Add webhook payload retention TTL (§4.2.5)
10. Add idempotency keys to billing-portal and customer-sessions endpoints (§1.2)
11. Add 5xx retry logic to api-client (§3.2)
12. Add PCI-specific fields to sanitize list (§4.1.1)

### Medium-term (P2 — 2-4 weeks)
13. Add user data export endpoint (§4.2.4)
14. Wire sanitizeFields into logging pipeline (§5.2)
15. Add @Audit() to all mutating endpoints (§4.4.3)
16. Add automated audit log purge job (§4.4.2)
17. Clean up subscriptions.service.ts double-key issue (§2.4)
18. Remove idempotency key from apiClient.delete() (§1.3)

### Long-term (P3 — 1-3 months)
19. Cascade PII anonymization on customer delete (§4.3.1)
20. Reconcile externally-created PIs from webhooks (§3.4)
21. Implement GDPR consent tracking and cookie preferences
22. Add Data Protection Impact Assessment (DPIA) documentation
