# ADR 0003: Eventual Consistency with Webhook Healing

## Status
Accepted

## Context
User-initiated Stripe mutations (create PaymentIntent, create Subscription, etc.) involve two distributed systems: Stripe's API and the local Oracle database. A network partition or DB failure between the Stripe API call and the local DB insert creates inconsistency:
- Stripe succeeds, DB fails → Customer charged, no local record (cannot refund, cannot show history)
- DB succeeds, Stripe fails → Phantom local record that never reached Stripe

Strict two-phase commit across Stripe + Oracle is impossible. Outbox/CDC patterns add significant complexity.

## Decision
Adopt an **eventual consistency** model with compensating mechanisms:

1. **Stripe-first writes** — Call Stripe API before writing to DB. Use idempotency keys on all Stripe writes so retries are safe.
2. **Webhook healing** — If DB fails after Stripe succeeds, the corresponding Stripe webhook (`payment_intent.succeeded`, `invoice.created`, etc.) will arrive and create/update the missing local record.
3. **Reconciliation backfill** — A scheduled job queries Stripe for recently updated objects and backfills any missing local records.
4. **Critical alerting** — If Stripe succeeds but DB fails, emit a CRITICAL log/alarm so ops can investigate immediately.
5. **No DB writes before Stripe API calls** — This avoids phantom records.

## Consequences
- Temporary inconsistency is tolerated and expected
- Webhook delivery latency (seconds to minutes) determines healing speed
- System is simpler than outbox/CDC but requires robust webhook handling and alerting
- All webhook handlers must be idempotent (duplicate events must not corrupt data)
