# Progress

## Status
In Progress

## Tasks
- [x] Stripe webhook coverage audit (see stripe-webhook-coverage.md)

## Files Changed
- `stripe-webhook-coverage.md` — comprehensive Stripe webhook audit

## Notes
- All Stripe webhook logic lives in `apps/api/src/webhooks/`. The `apps/webhooks/` app is an empty scaffold.
- 46 Stripe event types handled across 11 handlers. Identified ~40+ commonly-needed events not implemented.
