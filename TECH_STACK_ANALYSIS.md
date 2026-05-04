# Tech Stack Analysis

## Monorepo Structure

```
stripe-final-final/
├── apps/
│   ├── api/          NestJS 10 backend (port 3001)
│   └── web/          Next.js 14 App Router frontend (port 3000)
├── packages/
│   └── shared-types/ Shared TypeScript type definitions
├── turbo.json        Turborepo pipeline configuration
└── docker-compose.yml  Local development stack
```

**Build system**: Turborepo v2 — parallel builds across workspaces with remote cache support.

---

## Tech Stack Inventory

```json
{
  "backend": {
    "runtime": "Node.js 20 (Alpine in Docker)",
    "framework": "NestJS 10.4.x",
    "language": "TypeScript 5.6.x (strict mode)",
    "orm": "TypeORM 0.3.x",
    "database": "Oracle XE 21c (oracledb v6 thin mode — no Oracle Instant Client)",
    "validation": "class-validator 0.14 + class-transformer 0.5",
    "auth": "NestJS Passport JWT (@nestjs/passport + passport-jwt)",
    "rateLimiting": "@nestjs/throttler v6 (named throttlers: default + payment)",
    "logging": "Winston 3.x via nest-winston",
    "security": "helmet v8, compression v1.7",
    "payments": "Stripe SDK v17.4"
  },
  "frontend": {
    "framework": "Next.js 14.2 (App Router, standalone output)",
    "language": "TypeScript 5.6.x (strict mode)",
    "state": "Redux Toolkit v2 + RTK Query",
    "styling": "Tailwind CSS 3.4",
    "payments": "@stripe/react-stripe-js v2 + @stripe/stripe-js v4"
  },
  "infrastructure": {
    "containerization": "Docker (multi-stage builds: dev → build → production)",
    "localStack": "Docker Compose (Oracle XE + API + Web)",
    "cicd": "GitHub Actions (.github/workflows/ci.yml)"
  }
}
```

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | Oracle XE 21c | Existing requirement |
| ORM | TypeORM with `synchronize: false` | Migrations-only schema management |
| Oracle driver | oracledb v6 thin mode | No Oracle Instant Client installation required |
| Auth | Stateless JWT (Bearer token) | No session store dependency; scales horizontally |
| Payment Elements | `redirect: 'if_required'` | Users never leave the app |
| Webhook body | `rawBody: true` in NestFactory | Stripe HMAC signature verification requires raw body |
| Idempotency | DB-level check + Stripe idempotency keys | Prevents duplicate charges on network retries |
| Rate limiting | Named throttlers (default: 100/60s, payment: 20/60s) | Tighter limits on financial write endpoints |
| API versioning | URI versioning (`/api/v1/`) | Clear deprecation path |

---

## Stripe Integration Surface

| Feature | Endpoint(s) | Status |
|---|---|---|
| Customers | `POST/GET/PATCH/DELETE /api/v1/customers` | ✓ |
| Payment Intents | `POST/GET/PATCH/DELETE /api/v1/payment-intents` | ✓ |
| Setup Intents | `POST/GET/DELETE /api/v1/setup-intents` | ✓ |
| Payment Methods | `GET/DELETE /api/v1/payment-methods` | ✓ |
| Subscriptions | `POST/GET/PATCH/DELETE /api/v1/subscriptions` | ✓ |
| Webhooks | `POST /api/v1/webhooks/stripe` | ✓ HMAC verified |
| Reporting | `GET /api/v1/reports/*` | ✓ |
| Health | `GET /api/v1/health` | ✓ |

---

## Database Schema (7 Entities)

| Table | Key Columns | Notes |
|---|---|---|
| `STRIPE_CUSTOMERS` | id, stripeCustomerId, email, isDeleted | Soft delete |
| `STRIPE_PAYMENT_INTENTS` | id, stripePaymentIntentId, amount, currency, status, clientSecret | Idempotency |
| `STRIPE_SETUP_INTENTS` | id, stripeSetupIntentId, status, clientSecret | Idempotency |
| `STRIPE_PAYMENT_METHODS` | id, stripePaymentMethodId, type, last4, brand, isDefault | FK → CUSTOMERS |
| `STRIPE_SUBSCRIPTIONS` | id, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd | FK → CUSTOMERS |
| `STRIPE_WEBHOOK_EVENTS` | id, stripeEventId, eventType, payload, status, retryCount | Dedup by stripeEventId |
| `SUBSCRIPTION_PLANS` | id, stripePriceId, amount, currency, intervalType, isActive | Seeded from Stripe |

---

## Environment Variables Required

See `apps/api/src/config/validation.schema.ts` for full schema.

| Variable | Required | Description |
|---|---|---|
| `ORACLE_USER` | Yes | DB username |
| `ORACLE_PASSWORD` | Yes | DB password |
| `ORACLE_HOST` | Yes | DB host |
| `ORACLE_SERVICE_NAME` | No (default: `XEPDB1`) | Oracle pluggable DB service name |
| `STRIPE_SECRET_KEY` | Yes | Must match `sk_test_*` or `sk_live_*` |
| `STRIPE_WEBHOOK_SECRET` | Yes | Must match `whsec_*` |
| `CORS_ORIGIN` | Yes | Frontend origin (e.g. `https://app.example.com`) |
| `JWT_SECRET` | Yes | Min 32 characters |
| `NODE_ENV` | No (default: `development`) | `development` \| `production` \| `test` |
| `PORT` | No (default: `3001`) | API listen port |

Frontend (`.env.local`):

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Stripe publishable key |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (client-side) |
| `API_URL` | Yes | Backend API URL (server-side, internal) |
