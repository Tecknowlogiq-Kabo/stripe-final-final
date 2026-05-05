# ADR 0002: Stripe-to-Database Sync Strategy

## Status
Accepted

## Context
Stripe is the source of truth for all financial data. The application maintains a local Oracle database copy for fast reads and offline querying. Webhooks are the primary sync mechanism, but webhooks can be delayed, retried, lost, or arrive out of order (e.g., `invoice.created` before `subscription.created`).

## Decision
Adopt a **Hybrid Sync** strategy:

1. **Webhooks are primary** — Stripe webhooks update local records via typed handlers.
2. **Lazy hydration on read** — If a record is missing in the DB on read, fetch it from Stripe API, store it, then return.
3. **Scheduled backfill** — A periodic job (daily or weekly) queries Stripe for recently updated objects and reconciles the local DB.
4. **Deferred parent creation** — Webhook handlers that create child records (Invoice, Charge) must be resilient to missing parent records. If a parent (e.g., Subscription, PaymentIntent) does not exist locally, the handler fetches it from Stripe API and creates it before creating the child.

## Consequences
- Local DB is eventually consistent but self-healing
- Foreign key violations during out-of-order webhooks are avoided
- Backfill job requires Stripe API pagination; must respect rate limits
- Extra Stripe API calls on cache miss increase latency slightly
