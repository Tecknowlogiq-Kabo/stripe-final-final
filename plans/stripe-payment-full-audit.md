# Stripe Payment System — Complete Audit & Plan

## Context

This project (`stripe-final-final`) is a NestJS + Next.js monorepo integrating Stripe for payments, subscriptions, and billing. The user wants **everything** about the payment system documented — all data stored in the DB, all handlers, all API surfaces, every entity, every webhook event, and the full lifecycle of a payment.

---

## 1. Full Database Schema — What Payment Data is Stored

### `STRIPE_PAYMENT_INTENTS` (the core "payment" record)

| Column | Type | What it stores |
|--------|------|---------------|
| `ID` | UUID (PK) | Local primary key |
| `STRIPE_PI_ID` | VARCHAR2(100), UNIQUE | Stripe's PaymentIntent ID (e.g. `pi_xxx`) |
| `AMOUNT` | NUMBER(15,0) | Amount in smallest currency unit (cents) |
| `CURRENCY` | VARCHAR2(3) | ISO 4217 3-letter code (usd, eur) |
| `STATUS` | VARCHAR2(50) | succeeded/processing/requires_action/requires_payment_method/canceled/etc |
| `CLIENT_SECRET` | VARCHAR2(500) | Token for client-side confirmation via Stripe.js |
| `CUSTOMER_ID` | VARCHAR2(36) FK | → `STRIPE_CUSTOMERS.ID` |
| `STRIPE_PM_ID` | VARCHAR2(100) | Stripe PaymentMethod ID used |
| `IDEMPOTENCY_KEY` | VARCHAR2(255) | Deduplication key |
| `METADATA` | CLOB | Arbitrary key-value pairs (JSON) |
| `DESCRIPTION` | VARCHAR2(4000) | Human-readable description |
| `ERROR_CODE` | VARCHAR2(100) | Stripe error code on failure |
| `ERROR_DECLINE_CODE` | VARCHAR2(100) | Stripe decline code |
| `ERROR_MESSAGE` | VARCHAR2(4000) | Full error message |
| `SETUP_FUTURE_USAGE` | VARCHAR2(20) | on_session/off_session |
| `NEXT_ACTION` | CLOB | 3D Secure/SCA redirect payload (JSON) |
| `PAYMENT_METHOD_TYPES` | VARCHAR2(500) | Comma-separated accepted PM types |
| `AMOUNT_RECEIVED` | NUMBER(15,0) | Amount already captured |
| `AMOUNT_CAPTURABLE` | NUMBER(15,0) | Amount available for capture |
| `RECEIPT_EMAIL` | VARCHAR2(255) | Receipt destination |
| `STATEMENT_DESCRIPTOR` | VARCHAR2(22) | Text on bank statement |
| `LIVEMODE` | NUMBER(1) | 0=test, 1=live |
| `CREATED_AT` / `UPDATED_AT` | TIMESTAMP | Audit timestamps |

### `STRIPE_CUSTOMERS`

| Column | Type | Notes |
|--------|------|-------|
| `ID` | UUID (PK) | Local primary key |
| `STRIPE_CUSTOMER_ID` | VARCHAR2(50), UNIQUE | Stripe customer ID (`cus_xxx`) |
| `EMAIL` | VARCHAR2(255) | Customer email |
| `NAME` | VARCHAR2(255) | Nullable |
| `PHONE` | VARCHAR2(50) | Nullable |
| `METADATA` | CLOB | JSON |
| `IDEMPOTENCY_KEY` | VARCHAR2(255) | |
| `USER_ID` | VARCHAR2(36) | FK to `APP_USERS` (nullable) |
| `IS_DELETED` | NUMBER(1) | Soft delete flag |

Has OneToMany: paymentMethods, paymentIntents, setupIntents, subscriptions

### `STRIPE_PAYMENT_METHODS`

| Column | Type | Notes |
|--------|------|-------|
| `ID` | UUID (PK) | |
| `STRIPE_PM_ID` | VARCHAR2(100), UNIQUE | Stripe PaymentMethod ID (`pm_xxx`) |
| `TYPE` | VARCHAR2(50) | card, us_bank_account, sepa_debit, etc. |
| `LAST4` | VARCHAR2(4) | Last 4 digits (PCI-safe) |
| `BRAND` | VARCHAR2(50) | visa, mastercard, amex, etc. |
| `EXP_MONTH` / `EXP_YEAR` | NUMBER | Expiry |
| `FINGERPRINT` | VARCHAR2(100) | Stripe card fingerprint |
| `DETAILS` | CLOB | Full PM details JSON (no PAN) |
| `BILLING_DETAILS` | CLOB | Billing address JSON |
| `CARD_WALLET_TYPE` | VARCHAR2(50) | apple_pay, google_pay |
| `COUNTRY` | VARCHAR2(2) | Issuing country ISO |
| `FUNDING` | VARCHAR2(20) | credit, debit, prepaid |
| `CUSTOMER_ID` | VARCHAR2(36) FK | → `STRIPE_CUSTOMERS.ID` |
| `IS_DEFAULT` | NUMBER(1) | Default payment method flag |

### `STRIPE_SETUP_INTENTS`

| Column | Type | Notes |
|--------|------|-------|
| `ID` | UUID (PK) | |
| `STRIPE_SI_ID` | VARCHAR2(100), UNIQUE | Stripe SetupIntent ID (`seti_xxx`) |
| `STATUS` | VARCHAR2(50) | succeeded, requires_action, etc. |
| `CLIENT_SECRET` | VARCHAR2(500) | |
| `CUSTOMER_ID` | VARCHAR2(36) FK | → `STRIPE_CUSTOMERS.ID` |
| `STRIPE_PM_ID` | VARCHAR2(100) | Attached PM |
| `PAYMENT_METHOD_TYPES` | VARCHAR2(500) | |
| `USAGE` | VARCHAR2(20) | on_session/off_session |
| `LAST_SETUP_ERROR` | CLOB | Error JSON |
| `NEXT_ACTION` | CLOB | SCA payload |
| `LIVEMODE` | NUMBER(1) | |

### `STRIPE_SUBSCRIPTIONS`

| Column | Type | Notes |
|--------|------|-------|
| `ID` | UUID (PK) | |
| `STRIPE_SUB_ID` | VARCHAR2(100), UNIQUE | Stripe Subscription ID (`sub_xxx`) |
| `STATUS` | VARCHAR2(50) | active, past_due, unpaid, canceled, etc. |
| `CURRENT_PERIOD_START` / `CURRENT_PERIOD_END` | TIMESTAMP | Billing cycle boundaries |
| `CANCEL_AT_PERIOD_END` | NUMBER(1) | Will cancel at period end |
| `TRIAL_START` / `TRIAL_END` | TIMESTAMP | Trial period |
| `STRIPE_PRICE_ID` | VARCHAR2(100) | Stripe Price ID |
| `DEFAULT_PM_ID` | VARCHAR2(100) | Default payment method |
| `CUSTOMER_ID` | VARCHAR2(36) FK | → `STRIPE_CUSTOMERS.ID` |

### `STRIPE_WEBHOOK_EVENTS`

| Column | Type | Notes |
|--------|------|-------|
| `ID` | UUID (PK) | |
| `STRIPE_EVENT_ID` | VARCHAR2(100), UNIQUE | Stripe event ID (`evt_xxx`) |
| `EVENT_TYPE` | VARCHAR2(100) | e.g. `payment_intent.succeeded` |
| `PAYLOAD` | CLOB | **Encrypted** full event JSON |
| `STATUS` | VARCHAR2(20) | pending → processed/failed/skipped |
| `ERROR_MESSAGE` | VARCHAR2(4000) | Failure reason |
| `RETRY_COUNT` | NUMBER | Retry attempts |
| `PROCESSED_AT` | TIMESTAMP | When processing completed |

### What is **NEVER** stored locally (PCI-DSS SAQ A compliance)

- ❌ Full card numbers (PAN)
- ❌ CVC/CVV
- ❌ Bank account numbers
- ❌ SSN / tax IDs
- ❌ Raw sensitive Stripe tokens

---

## 2. API Endpoints — Payment Surface

### Payment Intents (`/api/v1/payment-intents`)

| Method | Path | Auth | Throttle | Description |
|--------|------|------|----------|-------------|
| `POST` | `/` | JWT | 20/min | Create a PaymentIntent |
| `GET` | `/mine` | JWT | default | List user's own PIs |
| `GET` | `/stripe/:stripeId` | JWT | default | Find by Stripe PI ID |
| `GET` | `/:id` | JWT | default | Find by local UUID (full details) |
| `PATCH` | `/:id` | JWT | default | Update metadata |
| `DELETE` | `/:id` | JWT | default | Cancel a PI |

**Public response shape** (`toPublicPaymentIntent`):
```typescript
{
  id: string;                  // local UUID
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  amountReceived?: number;
  receiptEmail?: string;
  statementDescriptor?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Note: `clientSecret`, `errorCode`, `errorMessage`, `nextAction`, `idempotencyKey`, `metadata` are **NOT** exposed in public responses — only the status-check endpoint (`/stripe/:stripeId`) returns `errorMessage`.

### Create PaymentIntent DTO

```typescript
{
  amount: number;                    // Required, 50-99999999 (cents)
  currency: string;                  // Required, ISO 4217 (e.g. 'usd')
  paymentMethodId?: string;          // Existing PM to use
  setupFutureUsage?: 'on_session' | 'off_session';
  receiptEmail?: string;
  statementDescriptor?: string;      // Max 22 chars, alphanumeric+spaces
  paymentMethodTypes?: string[];     // e.g. ['card', 'ideal']
  metadata?: Record<string, string>;
  description?: string;              // Max 4000 chars
}
```

### Other Payment-Related Controllers

| Controller | Endpoints | Auth |
|-----------|-----------|------|
| Customers | CRUD `/customers` | JWT (ownership) |
| Payment Methods | GET/DELETE/PATCH `/payment-methods` | JWT (ownership) |
| Setup Intents | POST/GET/DELETE `/setup-intents` | JWT (ownership) |
| Subscriptions | POST/GET/PATCH/DELETE `/subscriptions` | JWT (ownership) |
| Webhooks | POST `/webhooks/stripe` | HMAC signature (no auth) |
| Reports | GET `/reports/*` (7 endpoints) | Admin or ownership |
| Trust | POST/GET `/trust/*` | TrustId guard or public |

### Reporting Endpoints (Admin)

| Endpoint | Description |
|----------|-------------|
| `GET /reports/revenue/:year` | Revenue by month |
| `GET /reports/subscriptions/by-plan` | Active subscribers per plan |
| `GET /reports/subscriptions/churn` | Churn rate over N months |
| `GET /reports/customers/:customerId/ltv` | Single customer LTV |
| `GET /reports/payments/failed-by-decline-code` | Failure patterns |
| `GET /reports/webhooks/health` | Webhook processing health (public) |
| `GET /reports/customers/cohort-ltv` | Cohort LTV analysis |

---

## 3. Webhook Pipeline — How Payments Flow

### Architecture

```
Stripe → POST /api/v1/webhooks/stripe
  → HMAC signature verification (constructEvent)
  → WebhooksService.processEvent()
    → 1. Check idempotency (STRIPE_WEBHOOK_EVENTS by stripeEventId)
    → 2. Encrypt full payload
    → 3. Insert/re-queue in STRIPE_WEBHOOK_EVENTS
    → 4. Enqueue to BullMQ (WEBHOOK_QUEUE)
    → 5. Return 200 to Stripe (async processing)
  → Worker dequeues → WebhooksService.execute()
    → 1. Decrypt payload from DB
    → 2. Dispatch to typed handler by event type
    → 3. Mark processed/failed in DB
```

### Handler Registry (46 Events, 12 Handlers)

| Handler | Events Handled |
|---------|---------------|
| **PaymentIntentHandler** | `succeeded`, `payment_failed`, `canceled`, `processing`, `requires_action`, `amount_capturable_updated` |
| **SetupIntentHandler** | `succeeded`, `setup_failed`, `canceled`, `requires_action` |
| **SubscriptionHandler** | `created`, `updated`, `deleted`, `trial_will_end`, `paused`, `resumed`, `pending_update_applied`, `pending_update_expired` |
| **InvoiceHandler** | `payment_succeeded`, `payment_failed`, `upcoming`, `created`, `finalized`, `paid`, `voided`, `marked_uncollectible` |
| **PaymentMethodHandler** | `attached`, `detached`, `updated`, `card_automatically_updated` |
| **CustomerHandler** | `created`, `updated`, `deleted`, `discount.created`, `discount.deleted` |
| **MandateHandler** | `updated` |
| **ChargeHandler** | `succeeded`, `failed`, `refunded`, `dispute.created`, `dispute.closed`, `dispute.updated` |
| **RadarHandler** | `early_fraud_warning` |
| **AccountHandler** | `updated` |
| **CheckoutSessionHandler** | `completed`, `async_payment_succeeded`, `expired` |

### What Each Handler Does

**PaymentIntentHandler**: Updates `STRIPE_PAYMENT_INTENTS.STATUS`, captures error details on failure, records `next_action` payload for SCA, tracks `amount_received`.

**ChargeHandler**: Logs + audits charges (succeeded, failed, refunded) and disputes (created, closed, updated). **Charges are NOT persisted to a dedicated table** — only logged and audited. Dispute details are stored in `AUDIT_LOGS` only.

**InvoiceHandler**: Logs invoice lifecycle events. On payment failure, proactively marks the subscription `past_due`. On `invoice.paid`, reactivates `past_due` → `active`. On `marked_uncollectible`, marks subscription `unpaid`.

**CheckoutSessionHandler**: When a checkout session completes with `trustId` in metadata, auto-approves the trust token (triggers S3 pull if file resource).

---

## 4. Frontend Payment Flow

### Components

| File | Purpose |
|------|---------|
| `StripeProvider.tsx` | Wraps app in `<Elements>` with Stripe.js instance |
| `PaymentForm.tsx` | `<PaymentElement>` with confirm, error handling, status mapping |
| `SetupForm.tsx` | Saves payment methods via SetupIntent |
| `stripe.ts` | Singleton `loadStripe()` with publishable key |
| `stripe-errors.ts` | Comprehensive error mapper (200+ lines) |

### Error Classification (Frontend)

The `stripe-errors.ts` library handles:

- **StripeError types**: `card_error`, `validation_error`, `api_error`, `api_connection_error`, `idempotency_error`, `rate_limit_error`, `invalid_request_error`, `authentication_error`
- **Decline codes**: `lost_card`, `stolen_card`, `pickup_card`, `card_velocity_exceeded`, `transaction_not_allowed`, `restricted_card`, `do_not_honor`, `generic_decline`, `insufficient_funds`, `expired_card`, `incorrect_cvc`, `incorrect_number`, `processing_error`, `fraudulent`, `issuer_not_available`, `try_again_later`, `authentication_required`
- **PaymentIntent statuses**: All mapped to user-friendly messages with recoverability classification
- **SetupIntent statuses**: All mapped similarly
- **Payment method labels**: Dynamically derived (e.g., "Apple Pay", "your card", "Klarna", "iDEAL")
- **Recoverability**: Every error is classified as `recoverable`, `non-recoverable`, or `retry`

### Payment Confirmation Flow

```
User clicks "Pay Now"
  → stripe.confirmPayment({ elements, confirmParams: { return_url }, redirect: 'if_required' })
  → Error? → mapStripeError() → show alert
  → No paymentIntent? → "No payment result"
  → Status not success? → mapPaymentIntentStatus() → show alert
  → Success → onSuccess({ paymentIntentId, status })
```

---

## 5. TrustId + Checkout Integration (bsnconnect-like flow)

This appears to be what you're calling "bsnconnect" — a trusted access/gating system:

```
POST /trust/tokens → { trustId, tokenId, guestLink, expiresAt }
  ↓
Guest opens guestLink → resource info displayed
  ↓
Guest clicks Approve → POST /trust/:trustId/approve
  ↓
TrustService.approve() → S3 file pull (if resourceType=file)
  ↓
Also triggered via: CheckoutSessionHandler (checkout.session.completed with trustId in metadata)
```

---

## 6. What's Missing — Payment Data NOT in the DB

Based on ADR 0001 and the current entity list:

| Stripe Object | DB Table? | Status |
|---------------|-----------|--------|
| PaymentIntent | ✅ `STRIPE_PAYMENT_INTENTS` | Complete |
| Customer | ✅ `STRIPE_CUSTOMERS` | Complete |
| PaymentMethod | ✅ `STRIPE_PAYMENT_METHODS` | Complete |
| SetupIntent | ✅ `STRIPE_SETUP_INTENTS` | Complete |
| Subscription | ✅ `STRIPE_SUBSCRIPTIONS` | Complete |
| WebhookEvent | ✅ `STRIPE_WEBHOOK_EVENTS` | Complete (encrypted) |
| **Charge** | ❌ | Only in AUDIT_LOGS + logs, no dedicated table |
| **Invoice** | ❌ | Only logged, no `STRIPE_INVOICES` table |
| **Mandate** | ❌ | Handler exists but no entity/table |
| **Refund** | ❌ | Deferred per ADR 0001 |
| **Dispute** | ❌ | Only in AUDIT_LOGS via ChargeHandler |
| **BalanceTransaction** | ❌ | Deferred per ADR 0001 |
| **Product/Price** | ⚠️ | `SUBSCRIPTION_PLANS` is a cache, not full sync |

### Critical Gap: Charges are NOT persisted to a dedicated table

The ChargeHandler handles 6 events (succeeded, failed, refunded, 3 dispute events) but **only logs and writes to AUDIT_LOGS**. There is no `STRIPE_CHARGES` table. This means:
- You cannot query charge history from the DB
- Payment retry timelines cannot be reconstructed
- A PaymentIntent may have multiple Charges (retries) but you can't see them locally
- Disputes are only in audit logs — no structured querying

### Critical Gap: Invoices are NOT persisted to a dedicated table

The InvoiceHandler handles 8 events but **only logs**. There is no `STRIPE_INVOICES` table. This was called out in ADR 0001 as required: "Required for billing history page; itemized bills with line items, status, and PDF URL."

### Critical Gap: Mandates have no entity

ADR 0001 says mandates are "Required for SEPA/recurring debit compliance; legal customer permission record." The handler exists but there is no `STRIPE_MANDATES` entity/table.

---

## 7. Architecture Decisions (from ADRs)

- **Hybrid sync**: Webhooks primary, lazy hydration on cache miss, scheduled backfill, deferred parent creation
- **PCI scope**: SAQ A — card data never touches servers
- **Webhook encryption**: Payloads encrypted at rest in `STRIPE_WEBHOOK_EVENTS`
- **Ownership**: Every user owns exactly one StripeCustomer; all endpoints enforce ownership
- **Audit immutability**: `AUDIT_LOGS` is append-only, no updates/deletes
- **Error taxonomy**: 4 canonical classes — PaymentDeclinedError (402), StripeRateLimitError (429), StripeServiceError (503), InternalServiceError (500)

---

## 8. Recommended Plan — Complete Payment Data Coverage

### Phase 1: Add Missing Entities (3 new tables)

- [ ] 1. Create `stripe-charge.entity.ts` — `STRIPE_CHARGES` table
  - stripeChargeId, stripePaymentIntentId, amount, currency, status, failure_code, failure_message, outcome, amount_refunded, receipt_url, payment_method_details
- [ ] 2. Create `stripe-invoice.entity.ts` — `STRIPE_INVOICES` table
  - stripeInvoiceId, stripeCustomerId, stripeSubscriptionId, amount_due, amount_paid, currency, status, due_date, invoice_pdf, hosted_invoice_url, attempt_count
- [ ] 3. Create `stripe-mandate.entity.ts` — `STRIPE_MANDATES` table
  - stripeMandateId, stripePaymentMethodId, status, type, customer_acceptance

### Phase 2: Persist in Webhook Handlers

- [ ] 4. Update `charge.handler.ts` — persist Charge records on all 6 events
- [ ] 5. Update `invoice.handler.ts` — persist Invoice records on all 8 events
- [ ] 6. Update `mandate.handler.ts` — persist Mandate records

### Phase 3: API + Query Surface

- [ ] 7. Add `GET /charges/mine` and `GET /charges/:id` endpoints
- [ ] 8. Add `GET /invoices/mine` and `GET /invoices/:id` endpoints
- [ ] 9. Update reporting to use local Charge/Invoice data

### Phase 4 (optional): Refunds & Disputes

- [ ] 10. Create `stripe-refund.entity.ts`
- [ ] 11. Create `stripe-dispute.entity.ts`
- [ ] 12. Add refund/dispute webhook handlers

---

## Verification

- Run existing 75 tests: `cd apps/api && npm test`
- Verify TypeScript compiles: `cd apps/api && npx tsc --noEmit`
- Verify Oracle migrations apply cleanly
- Test webhook pipeline end-to-end via Stripe CLI
- Verify new endpoints return proper data with ownership enforcement
