# Stripe Webhook Coverage Report

## Summary

All Stripe webhook handling lives in the **API app** (`apps/api/src/webhooks/`). The **webhooks app** (`apps/webhooks/`) exists as a directory scaffold with empty `src/webhooks/handlers/`, `src/common/`, and `src/config/` — zero TypeScript files, no webhook logic.

**Total Stripe event types handled: 46** (registered in the handler registry; 5 of those are log-only / no DB mutation).

---

## 1. Every Stripe Event Type Handled

### PaymentIntentHandler
**File:** `apps/api/src/webhooks/handlers/payment-intent.handler.ts`
**Service:** `PaymentIntentsService.updateStatus()`

| Event Type | Action |
|---|---|
| `payment_intent.succeeded` | DB status → `succeeded` |
| `payment_intent.payment_failed` | DB status → `requires_payment_method` + stores error code/decline/message |
| `payment_intent.canceled` | DB status → `canceled` |
| `payment_intent.processing` | DB status → `processing` + stores next_action + amount_received |
| `payment_intent.requires_action` | DB status → `requires_action` |
| `payment_intent.amount_capturable_updated` | **Log only** — no DB mutation |

---

### SetupIntentHandler
**File:** `apps/api/src/webhooks/handlers/setup-intent.handler.ts`
**Service:** `SetupIntentsService.updateStatus()`

| Event Type | Action |
|---|---|
| `setup_intent.succeeded` | DB status → `succeeded` + stores payment method ID |
| `setup_intent.setup_failed` | DB status → `requires_payment_method` + stores last_setup_error |
| `setup_intent.canceled` | DB status → `canceled` |
| `setup_intent.requires_action` | DB status → `requires_action` |

---

### SubscriptionHandler
**File:** `apps/api/src/webhooks/handlers/subscription.handler.ts`
**Service:** `SubscriptionsService.syncFromStripeEvent()`

| Event Type | Action |
|---|---|
| `customer.subscription.created` | Full DB sync from Stripe event |
| `customer.subscription.updated` | Full DB sync from Stripe event |
| `customer.subscription.deleted` | Full DB sync from Stripe event |
| `customer.subscription.trial_will_end` | Full DB sync + log (suggests notification) |
| `customer.subscription.paused` | Full DB sync from Stripe event |
| `customer.subscription.resumed` | Full DB sync from Stripe event |
| `customer.subscription.pending_update_applied` | Full DB sync + log |
| `customer.subscription.pending_update_expired` | **Log only** — no DB mutation |

---

### InvoiceHandler
**File:** `apps/api/src/webhooks/handlers/invoice.handler.ts`
**Service:** `SubscriptionsService.findByStripeId()` + `setStatus()`

| Event Type | Action |
|---|---|
| `invoice.payment_succeeded` | If subscription-bound: sets sub status → `active`, logs |
| `invoice.payment_failed` | If subscription-bound + active: sets sub status → `past_due` |
| `invoice.upcoming` | **Log only** |
| `invoice.created` | **Log only** |
| `invoice.finalized` | **Log only** |
| `invoice.paid` | If subscription-bound + past_due: sets sub status → `active` |
| `invoice.voided` | **Log only** |
| `invoice.marked_uncollectible` | If subscription-bound: sets sub status → `unpaid` |

---

### PaymentMethodHandler
**File:** `apps/api/src/webhooks/handlers/payment-method.handler.ts`
**Service:** `PaymentMethodsService.upsertFromStripeEvent()` / `removeByStripeId()`

| Event Type | Action |
|---|---|
| `payment_method.attached` | DB upsert (insert or update) |
| `payment_method.updated` | DB upsert |
| `payment_method.detached` | DB remove by Stripe ID |
| `payment_method.card_automatically_updated` | DB upsert + log of previous attributes |

---

### CustomerHandler
**File:** `apps/api/src/webhooks/handlers/customer.handler.ts`
**Service:** `CustomersService.syncFromStripe()` / `syncSoftDelete()`

| Event Type | Action |
|---|---|
| `customer.created` | **Log only** (external customer creation) |
| `customer.updated` | DB sync from Stripe (survives not-found gracefully) |
| `customer.deleted` | DB `syncSoftDelete` (no Stripe API call — customer already deleted) |
| `customer.discount.created` | **Log only** (logs coupon details) |
| `customer.discount.deleted` | **Log only** (logs coupon details) |

---

### MandateHandler
**File:** `apps/api/src/webhooks/handlers/mandate.handler.ts`
**Service:** `PaymentMethodsService.syncFromStripeById()`

| Event Type | Action |
|---|---|
| `mandate.updated` | Re-syncs the parent payment method from Stripe |

---

### ChargeHandler
**File:** `apps/api/src/webhooks/handlers/charge.handler.ts`
**Service:** `AuditService.log()`

| Event Type | Action |
|---|---|
| `charge.succeeded` | **Log only** — no DB mutation |
| `charge.failed` | **Audit trail** — logs failure details including outcome |
| `charge.refunded` | **Log only** — no DB mutation |
| `charge.dispute.created` | **Audit trail** — logs dispute details + evidence deadline |
| `charge.dispute.closed` | **Audit trail** — logs outcome (status: `success` if won, `failure` if lost) |
| `charge.dispute.updated` | **Audit trail** — logs changed fields + previous attributes |

---

### RadarHandler
**File:** `apps/api/src/webhooks/handlers/radar.handler.ts`
**Service:** `AuditService.log()`

| Event Type | Action |
|---|---|
| `radar.early_fraud_warning` | **Audit trail** — logs fraud type, actionable flag, charge ID |

---

### AccountHandler
**File:** `apps/api/src/webhooks/handlers/account.handler.ts`
**Service:** `AuditService.log()`

| Event Type | Action |
|---|---|
| `account.updated` | **Audit trail** — logs changed fields, payouts_enabled, charges_enabled, capabilities |

---

### CheckoutSessionHandler
**File:** `apps/api/src/webhooks/handlers/checkout-session.handler.ts`
**Service:** `TrustService.approve()`

| Event Type | Action |
|---|---|
| `checkout.session.completed` | If metadata.trustId present → auto-approves trust token (triggers S3 pull for file type) |
| `checkout.session.async_payment_succeeded` | Same as `completed` |
| `checkout.session.expired` | **Log only** |

---

## 2. Stripe Webhook Signature Verification

**Guard:** `apps/api/src/common/guards/webhook-signature.guard.ts`
**Decorator:** `apps/api/src/common/decorators/stripe-event.decorator.ts`

### Flow:
1. `WebhookSignatureGuard` is applied via `@UseGuards()` on `WebhooksController.handleStripeWebhook()`
2. Extracts `stripe-signature` header from request (throws 400 if missing)
3. Reads `request.rawBody` (must be Buffer — throws 400 if missing)
4. Calls `StripeService.constructWebhookEvent(rawBody, signature, webhookSecret)` with tolerance of **300 seconds (5 minutes)** — generous, within Stripe's recommended max
5. `constructWebhookEvent` delegates to `stripe.webhooks.constructEvent()` SDK method
6. Verified event is attached to `request.stripeEvent`
7. `@StripeEvent()` decorator extracts `request.stripeEvent` into the controller parameter
8. Bad signature → throws `BadRequestException('Invalid webhook signature')`

### Config:
- Secret: `STRIPE_WEBHOOK_SECRET` env var → `apps/api/src/config/configuration.ts` line 13
- Raw body available via NestJS raw body parser middleware

---

## 3. Stripe Service Wrapper

**File:** `apps/api/src/stripe/stripe.service.ts`
**Module:** `apps/api/src/stripe/stripe.module.ts` (marked `@Global()` — accessible everywhere)

### Construction:
```typescript
new Stripe(secretKey, {
  apiVersion: '2026-03-25.dahlia',
  typescript: true,
  maxNetworkRetries: 2,
  telemetry: false,
})
```

### Exposed resource getters:
- `customers`, `paymentIntents`, `setupIntents`, `paymentMethods`
- `subscriptions`, `webhooks`, `confirmationTokens`, `customerSessions`
- `prices`, `billingPortal`, `products`, `invoices`

### Webhook signature method:
```typescript
constructWebhookEvent(payload: Buffer, signature: string, secret: string, tolerance?: number): Stripe.Event
```

---

## 4. Webhook Flow: Receipt → Processing → DB Storage

```
                               ┌─────────────────────────────┐
Stripe ►►► POST /webhooks/stripe                              │
                               │  WebhooksController           │
                               │  @Public() @SkipThrottle()    │
                               └─────────────┬───────────────┘
                                             │
                               ┌─────────────▼───────────────┐
                               │ WebhookSignatureGuard        │
                               │ 1. Check stripe-signature    │
                               │ 2. Read rawBody              │
                               │ 3. constructEvent()          │
                               │ 4. Attach to req.stripeEvent │
                               └─────────────┬───────────────┘
                                             │
                               ┌─────────────▼───────────────┐
                               │ WebhooksService.processEvent │
                               │ 1. Idempotency check          │
                               │    (findByStripeEventId)      │
                               │ 2. Encrypt payload            │
                               │ 3. INSERT/UPDATE webhook DB   │
                               │ 4. BullMQ.add(WEBHOOK_QUEUE)  │
                               └─────────────┬───────────────┘
                                             │
                     ┌───────────────────────▼───────────────────────┐
                     │ BullMQ WebhookProcessor (stripe-webhooks)     │
                     │ - 3 retries, exponential backoff (5s)         │
                     │ - OTel span wrapping                          │
                     └───────────────────────┬───────────────────────┘
                                             │
                               ┌─────────────▼───────────────┐
                               │ WebhooksService.execute      │
                               │ 1. Decrypt payload            │
                               │ 2. dispatch(event)            │
                               │ 3. markProcessed or markFailed│
                               └─────────────┬───────────────┘
                                             │
                               ┌─────────────▼───────────────┐
                               │ handlerRegistry.get(type)     │
                               │ ┌─────────────────────────┐  │
                               │ │ PaymentIntentHandler     │  │
                               │ │ SetupIntentHandler       │  │
                               │ │ SubscriptionHandler      │  │
                               │ │ InvoiceHandler           │  │
                               │ │ PaymentMethodHandler     │  │
                               │ │ CustomerHandler          │  │
                               │ │ MandateHandler           │  │
                               │ │ ChargeHandler            │  │
                               │ │ RadarHandler             │  │
                               │ │ AccountHandler           │  │
                               │ │ CheckoutSessionHandler   │  │
                               │ └──────────┬───────────────┘  │
                               └────────────┼──────────────────┘
                                            │
                               ┌────────────▼────────────────┐
                               │ Domain Services               │
                               │ PaymentIntentsService         │
                               │ SubscriptionsService          │
                               │ PaymentMethodsService         │
                               │ CustomersService              │
                               │ TrustService                  │
                               │ AuditService                  │
                               └──────────────────────────────┘
                                            │
                     ┌──────────────────────▼───────────────────────┐
                     │ On final failure (attempt ≥ max):            │
                     │ DLQ → stripe-webhooks-dlq (never expires)    │
                     └──────────────────────────────────────────────┘
```

### DB Storage:
- **Table:** `STRIPE_WEBHOOK_EVENTS`
- **Entity:** `apps/api/src/entities/stripe-webhook-event.entity.ts`
- **Repository:** `apps/api/src/webhooks/webhooks.repository.ts` (raw SQL via TypeORM DataSource)
- **Columns:** ID (UUID), STRIPE_EVENT_ID (unique index), EVENT_TYPE, PAYLOAD (encrypted CLOB), STATUS, ERROR_MESSAGE, RETRY_COUNT, PROCESSED_AT, CREATED_AT, UPDATED_AT
- Payload is **encrypted at rest** via `EncryptionService` before DB insert
- The service supports **retry**: existing failed/pending records are updated with fresh encrypted payload and their status reset to `pending`
- Already-processed events (`status === 'processed'`) are **skipped** (idempotent)

### Observability:
- Every step wrapped in OTel spans: `webhooks.processEvent`, `webhook.process`, `webhooks.execute`
- Prometheus alerting rules for DLQ depth and failed event rate
- Webhook health endpoint: `GET /reporting/webhooks/health` — returns event counts by type+status + avg processing seconds over last 24h
- Stripe `request-id` logged on all Stripe API errors via `StripeExceptionFilter`
- Correlation IDs propagated from inbound request through to logs

---

## 5. BullMQ Queue Setup

### Stripe Webhook Queue
**Constants:** `apps/api/src/webhooks/webhook-queue.constants.ts`
```typescript
WEBHOOK_QUEUE = 'stripe-webhooks'
WEBHOOK_DLQ = 'stripe-webhooks-dlq'
```
**Config** (in `WebhooksModule`):
- Queue: 3 retries, exponential backoff (5s base)
- Completed jobs removed after 7 days
- Failed jobs removed after 30 days
- DLQ: never auto-removed (manual review required)

### TrustID Webhook Queue
**Constants:** `apps/api/src/webhooks/trustid-webhook-queue.constants.ts`
```typescript
TRUSTID_WEBHOOK_QUEUE = 'trustid-webhooks'
TRUSTID_WEBHOOK_DLQ = 'trustid-webhooks-dlq'
```
**Config** (in `TrustIdWebhookModule`):
- Queue: 5 retries, exponential backoff (10s base)
- Completed/failed retention same as Stripe queue
- DLQ: never auto-removed

### Processor:
- **File:** `apps/api/src/webhooks/webhook.processor.ts` — `@Processor(WEBHOOK_QUEUE)`
- On failure: moves to DLQ after exhausting retries
- OTel span wrapping for trace visibility

---

## 6. Missing Commonly‑Needed Stripe Webhooks

The following are **not** registered in the handler registry and would log a warning as "Unhandled webhook event type":

### Dispute / Charge (financial settlement)
| Event | Why Needed |
|---|---|
| `charge.dispute.funds_reinstated` | Funds returned after winning a dispute — critical to track reconciliation |
| `charge.dispute.funds_withdrawn` | Funds withdrawn after losing a dispute |
| `charge.refund.updated` | Refund status changes (e.g., failed refund) |
| `charge.expired` | Authorized-but-uncaptured charges that expire |

### Payment Intents (extended)
| Event | Why Needed |
|---|---|
| `payment_intent.partially_funded` | Bank transfer / ACH partial funding before capture |
| `payment_intent.requires_capture` | Separate auth + capture flow — intent authorized but not captured |

### Invoice (extended)
| Event | Why Needed |
|---|---|
| `invoice.payment_action_required` | 3D Secure or other action needed on invoice |
| `invoice.updated` | Invoice metadata changes — could affect billing logic |
| `invoice.overdue` | Specific overdue notification beyond payment_failed |
| `invoice.deleted` | Invoice deletion in Stripe without void |

### Subscription (extended)
| Event | Why Needed |
|---|---|
| `customer.subscription.transfer.created` | Subscription transfers between accounts (Connect/mergers) |
| `customer.subscription.transfer.updated` | Transfer status changes |
| `customer.subscription.transfer.failed` | Transfer failures |

### Checkout Sessions
| Event | Why Needed |
|---|---|
| `checkout.session.async_payment_failed` | Async payment (e.g., bank transfer) fails — already handled for `async_payment_succeeded` but not this failure case |

### Product Catalog (if syncing catalog to local DB)
| Event | Why Needed |
|---|---|
| `price.created` | Keep product catalog in sync |
| `price.updated` | Price changes need local reflection |
| `price.deleted` | Stale price cleanup |
| `product.created` | Product creation tracking |
| `product.updated` | Product metadata changes |
| `product.deleted` | Product archival |
| `coupon.created` | Coupon management |
| `coupon.updated` | Coupon changes |
| `coupon.deleted` | Coupon cleanup |
| `promotion_code.*` | Promotion code lifecycle |

### Payouts (Connect/standalone)
| Event | Why Needed |
|---|---|
| `payout.created` | Payout tracking |
| `payout.paid` | Payout completed — reconciliation |
| `payout.failed` | Payout failure handling |
| `payout.updated` | Payout metadata changes |
| `balance.available` | Balance feed — for real-time ledger |

### Connect
| Event | Why Needed |
|---|---|
| `account.external_account.*` | Bank account / debit card changes on connected accounts |
| `account.application.*` | Connect application lifecycle |
| `capability.updated` | Connect capability status changes |
| `person.updated` | Person object changes (identity verification) |

### Tax
| Event | Why Needed |
|---|---|
| `tax_rate.created` | Tax rate sync |
| `tax_rate.updated` | Tax rate changes |
| `customer.tax_id.*` | Customer tax ID verification lifecycle |

### Radar / Review
| Event | Why Needed |
|---|---|
| `review.opened` | Manual review opened for payment — could pause fulfillment |
| `review.closed` | Review completed — resume fulfillment if approved |

### Reporting
| Event | Why Needed |
|---|---|
| `reporting.report_run.succeeded` | Report completed — trigger download |
| `reporting.report_run.failed` | Report failure notification |

### Billing / Credit Notes
| Event | Why Needed |
|---|---|
| `credit_note.created` | Credit note issuance |
| `credit_note.updated` | Credit note changes |
| `credit_note.voided` | Credit note voiding |

### Terminal
| Event | Why Needed |
|---|---|
| `terminal.reader.action_failed` | Terminal reader action failures |
| `terminal.reader.action_succeeded` | Reader actions completed |

### Quote
| Event | Why Needed |
|---|---|
| `quote.accepted` | Quote → subscription conversion |
| `quote.canceled` | Quote cancellation |
| `quote.finalized` | Quote finalization |

---

## Architecture Notes

### Controller Protection
- `@SkipThrottle()` — Stripe retries up to 3 days; rate limiting causes 429s that trigger unnecessary retries
- `@Public()` — bypasses global JWT guard
- Request timeout middleware **excludes** webhook routes (Stripe has its own timeout/retry logic)
- OTel spans trace the full pipeline: Stripe → receive → DB insert → BullMQ enqueue → worker dequeue → decrypt → dispatch → handler → DB commit

### TrustID Webhooks (separate webhook path)
- **Controller:** `apps/api/src/webhooks/trustid-webhook.controller.ts`
- **Endpoint:** `POST /api/v1/webhooks/trustid`
- Three workflow types: `AutoReferral` (Start/Stop), `UpdateDocument`
- "Start" → inline trust token status update to `submitted`
- "Stop" → enqueued to `trustid-webhooks` BullMQ queue → pulls documents from TrustID Cloud → uploads to S3 → marks token as `approved`
- TrustID module is separate from Stripe webhooks but lives in the same `webhooks/` directory

### Testing
- `webhooks.service.spec.ts` — comprehensive tests for processEvent (idempotency, insert, retry) and execute (dispatch, failure handling)
- `charge.handler.spec.ts` — tests all 6 charge/dispute sub-types
- `customer.handler.spec.ts` — tests soft-delete idempotency
- `radar.handler.spec.ts` — tests actionable and non-actionable fraud warnings
