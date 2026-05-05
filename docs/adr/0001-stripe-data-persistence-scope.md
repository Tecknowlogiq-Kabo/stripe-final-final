# ADR 0001: Stripe Data Persistence Scope

## Status
Accepted

## Context
The application integrates with Stripe for payments, subscriptions, and billing. Stripe holds the source of truth for all financial data, but the application needs a local copy for:
1. Fast reads without Stripe API latency
2. Offline query capability for dashboards
3. Audit and reconciliation requirements

The question was: which Stripe objects should be persisted locally?

## Decision
Persist the following Stripe objects locally:
- **Invoice** — Required for billing history page; itemized bills with line items, status, and PDF URL
- **Charge** — Required for granular payment attempt history; a PaymentIntent may have multiple Charges (retries)
- **Mandate** — Required for SEPA/recurring debit compliance; legal customer permission record

Explicitly deferred:
- **Refund** — Not needed until the product supports returns/cancellations
- **Dispute** — Not needed until payment volume justifies chargeback monitoring
- **Balance Transaction** — Only needed for marketplace/platform use cases
- **Product / Price full sync** — `SubscriptionPlan` cache is sufficient for now

## Consequences
- Billing history can be served from local DB
- Payment retry timelines can be reconstructed from Charge records
- SEPA mandate compliance is possible when that feature is added
- Refunds and disputes must be checked in Stripe dashboard until local entities are added
- Database migrations needed for three new tables
