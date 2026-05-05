# Domain Context — Stripe Integration App

## Glossary

| Term | Definition |
|------|------------|
| **User** | A registered end-user of the application, stored in `APP_USERS`. Authenticated via JWT. |
| **StripeCustomer** | The Stripe Customer object synced to `STRIPE_CUSTOMERS`. One per User. |
| **PaymentIntent** | A Stripe PaymentIntent synced to `STRIPE_PAYMENT_INTENTS`. Represents a single payment attempt. |
| **SetupIntent** | A Stripe SetupIntent synced to `STRIPE_SETUP_INTENTS`. Represents saving a payment method for future use. |
| **PaymentMethod** | A Stripe PaymentMethod synced to `STRIPE_PAYMENT_METHODS`. A card or wallet attached to a Customer. |
| **Subscription** | A Stripe Subscription synced to `STRIPE_SUBSCRIPTIONS`. Represents a recurring billing relationship. |
| **SubscriptionPlan** | A local cache of Stripe Price/Product data stored in `SUBSCRIPTION_PLANS`. |
| **WebhookEvent** | An incoming Stripe webhook event recorded in `STRIPE_WEBHOOK_EVENTS` for idempotency and traceability. |
| **AuditLog** | An immutable, append-only record in `AUDIT_LOGS` capturing user actions, auth events, and financial mutations. |
| **Ownership** | The policy that a User may only access Stripe resources belonging to their own StripeCustomer. |
| **Invoice** | A Stripe Invoice synced to `STRIPE_INVOICES`. The itemized bill for a subscription or one-off charge. |
| **Charge** | A Stripe Charge synced to `STRIPE_CHARGES`. A single attempt to move money, child of a PaymentIntent. |
| **Mandate** | A Stripe Mandate synced to `STRIPE_MANDATES`. Customer permission for recurring debit (e.g., SEPA). |
| **Admin** | A User with elevated privileges capable of viewing/managing any StripeCustomer's resources. |

## Domain Boundaries

- **Billing Context** (`apps/api/src`): All Stripe-related operations, webhook handling, reporting, and health checks.
- **Auth Context** (`apps/api/src/auth`): User registration, login, JWT issuance, token validation.
- **Audit Context** (`apps/api/src/audit` — proposed): Audit log creation, querying, retention enforcement.

## Key Policies

1. **Ownership (Self-service)** — Every User owns exactly one StripeCustomer. All API endpoints must verify the requested resource belongs to the authenticated user's StripeCustomer before returning data or processing mutations.
2. **Audit Immutability** — `AUDIT_LOGS` is append-only. No API or service may update or delete an audit record. Retention is enforced by scheduled purging of records older than the policy threshold.
3. **Webhook Idempotency** — Every Stripe webhook event is recorded in `STRIPE_WEBHOOK_EVENTS` before processing. Duplicate events (by Stripe event ID) are silently skipped.
4. **Admin Elevation** — A User with `IS_ADMIN = 1` bypasses ownership checks. All other Users are subject to strict Ownership enforcement. This is a simple boolean flag on `APP_USERS`, not a full RBAC system.
5. **Audit Log Schema** — Append-only `AUDIT_LOGS` table with: `ID`, `ACTOR_ID` (nullable), `ACTOR_TYPE` (`user|system|webhook`), `ACTION` (canonical), `RESOURCE_TYPE`, `RESOURCE_ID`, `STATUS` (`success|failure|denied`), `METADATA` (JSON), `IP_ADDRESS`, `USER_AGENT`, `CREATED_AT`. Indexed by `(ACTOR_ID, CREATED_AT)` and `(RESOURCE_TYPE, RESOURCE_ID, CREATED_AT)`. Failed auth attempts are recorded. Webhooks produce one audit record per event (not per side-effect).
6. **Error Taxonomy** — Four canonical error classes: `PaymentDeclinedError` (402), `StripeRateLimitError` (429 with `Retry-After`), `StripeServiceError` (503), `InternalServiceError` (500). All responses include `correlationId` and Stripe `requestId` when applicable.
7. **Rate Limiting** — Incoming: per-IP 10 req/min (unauth), per-user 100 req/min (auth), per-user 5 req/min (expensive ops). Webhook endpoint exempt. Outgoing: Stripe capped at 80 reads/sec and 80 writes/sec globally. `@nestjs/throttler` for incoming; token-bucket wrapper for outgoing batch/backfill.
8. **Auth Hardening** — Refresh tokens (7-day, DB-stored, rotated on use, revoked on logout) and email-based password reset are in scope for production readiness. 2FA/MFA and CSRF protection are deferred to post-MVP.
9. **Explicit Edge Cases** — The following must be explicitly handled: out-of-order webhooks (deferred parent creation), race on DB insert for same Stripe ID (upsert/retry), stale payment methods (webhook-driven soft-delete), mid-cycle subscription changes (proration display), partial refunds (deferred until refund entity exists), currency mismatch (cents vs dollars verification), network partition during payment confirmation (polling or webhook-driven state sync), JWT replay after logout (token blacklist or short expiry + refresh).
10. **Observability Backend** — SigNoz is the production observability backend. OpenTelemetry traces export to SigNoz OTLP endpoint. Metrics use Prometheus exposition format scraped by SigNoz. Logs are forwarded to SigNoz (via Fluent Bit or direct OTLP). Jaeger is used for local development only.
11. **Security** — Secrets managed via Docker secrets / environment injection (acceptable for current scale; Vault deferred). PCI scope is SAQ A (Stripe.js/Elements means card data never touches servers). Raw webhook payloads never logged to persistent storage; card numbers always redacted. User deletion soft-deletes locally and anonymizes the Stripe customer (retaining financial records for compliance).
