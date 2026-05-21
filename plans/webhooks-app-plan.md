# Webhooks App — Plan

## Context

The monorepo has a **standalone `apps/webhooks` NestJS microservice** already scaffolded and deployed (port 3002), but its `src/` directory is empty — only compiled JS exists in `dist/`. The actual webhook logic lives **inline in `apps/api/src/webhooks/`**, mixed into the main API app alongside auth, throttling, and user-facing endpoints.

This plan:
1. **Audits** Stripe and TrustID webhook coverage (already done by parallel agents).
2. **Pulls the webhook logic out** of the API app into the standalone `apps/webhooks/src/` with proper TypeScript source.
3. **Fills a few high-priority gaps** without over-engineering.

---

## Audit Results (from parallel agent teams)

### Stripe — 46 event types handled ✅
Coverage is **already comprehensive**: 11 handler classes covering PaymentIntents, SetupIntents, Subscriptions, Invoices, PaymentMethods, Customers, Mandates, Charges/Disputes, Radar, Account, and CheckoutSessions. Signature verification via `WebhookSignatureGuard` with HMAC-SHA256. Idempotency via `stripeEventId` dedup. Encrypted payload storage in Oracle. BullMQ async processing with DLQ.

**Missing (low priority, not adding unless asked):** `charge.dispute.funds_reinstated`, `checkout.session.async_payment_failed`, catalog sync events, Connect/payout events, tax events.

### TrustID — 3 webhook scenarios handled, 1 gap ⚠️
- `AutoReferral + Start` → inline status update to `submitted`
- `AutoReferral + Stop` → BullMQ async S3 document pull
- `UpdateDocument + Start` → log only
- **GAP (HIGH): No webhook auth** — endpoint is `@Public()` with no signature/shared-secret verification
- **GAP (MEDIUM): No idempotency** — `CallbackId` is logged but not deduped
- **GAP (MEDIUM): Missing `UpdateDocument + Stop`** handler — falls through to "Unknown WorkflowState" warning

---

## Approach

Populate `apps/webhooks/src/` with TypeScript source by extracting webhook logic from `apps/api/src/webhooks/`, adapting imports to use `@stripe-integration/domain` where the compiled dist already expects it. Add TrustID webhook auth (shared secret header verification).

### Key design decisions:
- **No new app** — use the existing `apps/webhooks` scaffold
- **Import domain services from `@stripe-integration/domain`** — matching the existing dist pattern
- **Port the webhook webhook setup** for the webhooks app (Stripe: keep existing `nest-cli.json` / `tsconfig.json` files under `apps/webhooks/`)
- **Don't touch the API app** — leave `apps/api/src/webhooks/` as-is (it can serve as fallback/dev)
- **Fill TrustID auth gap** only — don't go hunting for every missing Stripe event type

---

## Files to Create/Modify

### New files for `apps/webhooks/src/`:

| File | Source |
|------|--------|
| `main.ts` | Port from `apps/api/src/main.ts`, strip auth/throttler/health/reporting |
| `app.module.ts` | Already exists in dist — recreate TS: ConfigModule + DatabaseModule + RedisModule + WebhooksModule + TrustIdWebhookModule |
| `instrumentation.ts` | Copy from `apps/api/src/instrumentation.ts` (OTel setup) |
| `config/configuration.ts` | Config for port 3002, OTEL service name 'stripe-webhooks', redis URL |
| `common/guards/webhook-signature.guard.ts` | Copy from `apps/api/src/common/guards/webhook-signature.guard.ts`, adapt import to `@stripe-integration/domain` StripeService |
| `common/guards/trustid-webhook.guard.ts` | **NEW** — validates shared secret from `ContainerEventCallbackHeaders` |
| `common/decorators/stripe-event.decorator.ts` | Copy from `apps/api/src/common/decorators/` |
| `webhooks/webhooks.module.ts` | Port from `apps/api`, imports from `@stripe-integration/domain` |
| `webhooks/webhooks.controller.ts` | Port from `apps/api` |
| `webhooks/webhooks.service.ts` | Port from `apps/api` |
| `webhooks/webhooks.repository.ts` | Port from `apps/api` |
| `webhooks/webhook.processor.ts` | Port from `apps/api` |
| `webhooks/webhook-queue.constants.ts` | Port from `apps/api` |
| `webhooks/trustid-webhook.module.ts` | Port from `apps/api`, imports from `@stripe-integration/domain` |
| `webhooks/trustid-webhook.controller.ts` | Port from `apps/api`, **add guard** |
| `webhooks/trustid-webhook.processor.ts` | Port from `apps/api` |
| `webhooks/trustid-webhook-queue.constants.ts` | Port from `apps/api` |
| `webhooks/handlers/*.handler.ts` (11 Stripe + 2 TrustID) | Port from `apps/api`, adapt domain imports |

### Files to create for `apps/webhooks/` root:

| File | Action |
|------|--------|
| `package.json` | Create — NestJS deps matching dist imports |
| `tsconfig.json` | Create — standard NestJS tsconfig |
| `nest-cli.json` | Create — NestJS CLI config |

### Files to modify for the API app (`apps/api/`):

| File | Change |
|------|--------|
| `src/config/configuration.ts` | Add `trustid.webhookSecret` env var |
| `src/webhooks/trustid-webhook.controller.ts` | **Optionally** add `TrustIdWebhookGuard` (only if we want the API app to also verify) |

---

## Reuse (existing code)

| What | Where |
|------|-------|
| All 13 handlers | `apps/api/src/webhooks/handlers/*.handler.ts` |
| WebhooksService (dispatch + pipeline) | `apps/api/src/webhooks/webhooks.service.ts` |
| WebhooksController | `apps/api/src/webhooks/webhooks.controller.ts` |
| WebhookProcessor (BullMQ worker) | `apps/api/src/webhooks/webhook.processor.ts` |
| WebhooksRepository (Oracle CRUD) | `apps/api/src/webhooks/webhooks.repository.ts` |
| WebhookSignatureGuard (Stripe HMAC) | `apps/api/src/common/guards/webhook-signature.guard.ts` |
| StripeEvent decorator | `apps/api/src/common/decorators/stripe-event.decorator.ts` |
| TrustID controller + processor | `apps/api/src/webhooks/trustid-webhook.*.ts` |
| Instrumentation (OTel) | `apps/api/src/instrumentation.ts` |
| Configuration | `apps/api/src/config/configuration.ts` |
| Domain modules | `@stripe-integration/domain` (Customers, PaymentIntents, Trust, TrustId, S3, etc.) |

---

## Steps

- [ ] 1. Create `apps/webhooks/package.json` with NestJS dependencies
- [ ] 2. Create `apps/webhooks/tsconfig.json` and `apps/webhooks/nest-cli.json`
- [ ] 3. Create `apps/webhooks/src/config/configuration.ts` (port 3002, OTEL, redis, stripe + trustid webhook secrets)
- [ ] 4. Create `apps/webhooks/src/instrumentation.ts` (OTel SDK setup)
- [ ] 5. Create `apps/webhooks/src/main.ts` (bootstrap — no auth, no throttler, no health/reporting)
- [ ] 6. Create `apps/webhooks/src/common/guards/webhook-signature.guard.ts` (Stripe HMAC verification)
- [ ] 7. Create `apps/webhooks/src/common/guards/trustid-webhook.guard.ts` (NEW — shared secret header check)
- [ ] 8. Create `apps/webhooks/src/common/decorators/stripe-event.decorator.ts`
- [ ] 9. Port all 13 webhook handlers to `apps/webhooks/src/webhooks/handlers/`
- [ ] 10. Create `apps/webhooks/src/webhooks/webhooks.repository.ts`
- [ ] 11. Create `apps/webhooks/src/webhooks/webhooks.service.ts` (handler registry + processEvent + execute)
- [ ] 12. Create `apps/webhooks/src/webhooks/webhook.processor.ts` (BullMQ worker)
- [ ] 13. Create `apps/webhooks/src/webhooks/webhook-queue.constants.ts`
- [ ] 14. Create `apps/webhooks/src/webhooks/webhooks.controller.ts`
- [ ] 15. Create `apps/webhooks/src/webhooks/webhooks.module.ts`
- [ ] 16. Create `apps/webhooks/src/webhooks/trustid-webhook.controller.ts` (with TrustIdWebhookGuard)
- [ ] 17. Create `apps/webhooks/src/webhooks/trustid-webhook.processor.ts`
- [ ] 18. Create `apps/webhooks/src/webhooks/trustid-webhook-queue.constants.ts`
- [ ] 19. Create `apps/webhooks/src/webhooks/trustid-webhook.module.ts`
- [ ] 20. Create `apps/webhooks/src/app.module.ts` (root module wiring)
- [ ] 21. Add `trustid.webhookSecret` to env config and `.env.example` in the API app
- [ ] 22. Update TrustID guest link creation to pass `ContainerEventCallbackHeaders` with shared secret

---

## Verification

- **Build**: `cd apps/webhooks && npm run build` — should compile all TS to `dist/`
- **Lint**: `cd apps/webhooks && npm run lint` — should pass
- **Start**: `cd apps/webhooks && npm run start:dev` — should boot on port 3002 without auth/throttler errors
- **Stripe webhook test**: `curl -X POST http://localhost:3002/api/v1/webhooks/stripe` — should 400 (missing signature)
- **TrustID webhook test**: `curl -X POST http://localhost:3002/api/v1/webhooks/trustid` — should 401 (missing shared secret)
- **Existing tests**: Run `npm test` in `apps/api` — existing webhook service tests should still pass (they test the API app's copy)
- **Docker**: `docker-compose up webhooks` should start the service with Redis + Oracle dependencies
