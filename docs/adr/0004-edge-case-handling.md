# ADR 0004: Edge Case Handling

## Status
Accepted

## Context
Payment systems face numerous edge cases that, if unhandled, produce data inconsistency, financial leakage, or security gaps. The application already handles some basics (webhook idempotency via `STRIPE_WEBHOOK_EVENTS`), but several production-critical gaps remain.

## Decision
Explicitly handle the following edge cases:

1. **Out-of-order webhooks** — Webhook handlers creating child records (Invoice, Charge) must fetch missing parent records (Subscription, PaymentIntent) from Stripe API before creation to prevent foreign key violations.
2. **Race on DB insert for same Stripe ID** — All UPSERT operations must use database-level conflict resolution (`MERGE` in Oracle, or `INSERT` with `ON CONFLICT` semantics via TypeORM's `save` with partial primary key) rather than read-then-write.
3. **Stale payment methods** — `payment_method.detached` webhook handler soft-deletes the local `STRIPE_PAYMENT_METHODS` record by setting `IS_DELETED = 1`. List endpoints must filter `IS_DELETED = 0`.
4. **Mid-cycle subscription changes** — The application does not compute proration logic locally; it delegates to Stripe. However, frontend displays must handle the `proration_date` field from Stripe and show adjusted line items.
5. **Partial refunds** — Deferred until Refund entity is added. The `invoice.payment_failed` webhook handler must update local invoice status, and a future refund handler will create `REFUNDS` records linked to Charges.
6. **Currency mismatch** — All Stripe amounts are in cents (integer). Frontend must divide by 100 for display. Backend must validate that all `amount` fields are positive integers on API input.
7. **Network partition during payment confirmation** — Frontend polls `GET /api/v1/payment-intents/:id` every 3 seconds after Stripe.js confirms, up to 30 seconds. Webhooks also push state updates via server-sent events (deferred) or the client re-fetches on page load.
8. **JWT replay after logout** — Refresh tokens are revoked on logout. Access tokens have 15-minute expiry, limiting the replay window. A token blacklist (Redis or in-memory with TTL) is deferred until scale demands it.

## Consequences
- Webhook handlers become slightly more complex with parent-fetching logic
- Race conditions are eliminated at the DB level rather than application level
- Stale payment method data is prevented
- Frontend must handle prorated line items
- Refund support is acknowledged but not yet implemented
- Amount validation must be added to all DTOs
- Payment confirmation UX needs polling behavior
- Logout immediately invalidates refresh tokens, but access tokens have a bounded replay window
