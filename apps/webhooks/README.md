# @stripe-integration/webhooks

Dedicated NestJS service that receives Stripe webhook events, verifies the
signature, persists the event, and dispatches to the matching handler. Kept
separate from the public API so webhook throughput and failure modes do not
affect customer-facing traffic.

## Port

`3003` (override with `PORT`).

## Stripe events handled

Roughly 50 event types across these handler groups (see
`src/webhooks/handlers/`):

- `payment_intent.*` — succeeded, payment_failed, processing, requires_action, canceled, amount_capturable_updated
- `setup_intent.*` — succeeded, setup_failed, requires_action, canceled
- `payment_method.*` — attached, detached, updated, automatically_updated
- `customer.*` — created, updated, deleted, discount.created/deleted
- `customer.subscription.*` — created, updated, deleted, paused, resumed, trial_will_end, pending_update_*
- `invoice.*` — created, finalized, paid, payment_succeeded, payment_failed, marked_uncollectible, upcoming, voided
- `charge.*` — succeeded, failed, refunded, dispute.created/updated/closed
- `checkout.session.*` — completed, expired, async_payment_succeeded
- `mandate.*`, `account.*`, `radar.*`
- `trustid.*` — container + result handlers

For the canonical list see the `stripe-webhook-coverage.md` doc at the repo
root.

## Required environment

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET     # the signing secret for the endpoint
STRIPE_API_VERSION
ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_PORT, ORACLE_SERVICE_NAME
PORT                      # default 3003
OTEL_EXPORTER_OTLP_ENDPOINT
```

## Configuring the webhook secret

1. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint.
2. URL: `https://<host>:3003/webhooks/stripe`.
3. Select events (or "Send all events").
4. Copy the "Signing secret" (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
5. For local dev: `stripe listen --forward-to localhost:3003/webhooks/stripe`
   and use the secret it prints.

## Run

```bash
npm run dev          # nest start --watch
npm run start:prod   # node dist/main
npm run test         # jest
```
