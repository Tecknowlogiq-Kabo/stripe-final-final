# @stripe-integration/api

NestJS REST API for Stripe customers, payment intents, setup intents, payment
methods, and subscriptions. Backed by Oracle XE (raw SQL via TypeORM
`DataSource.query`) and Redis (BullMQ + throttler storage).

## Port

`3001` (override with `PORT`).

## Modules

- `AuthModule` — JWT auth, role guards, bcrypt hashing
- `CustomersModule`, `PaymentIntentsModule`, `SetupIntentsModule`,
  `PaymentMethodsModule`, `SubscriptionsModule` — Stripe domain modules
- `WebhooksModule` — internal webhook re-entry endpoint
- `ReportingModule`, `HealthModule`, `MetricsModule`, `AuditModule`
- `CryptoModule`, `S3Module`, `EmailModule`, `RedisModule`
- `TrustModule`, `TrustIdModule`, `TrustIdWebhookModule` — TrustID risk integration

## Required environment

```
ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_PORT, ORACLE_SERVICE_NAME
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_API_VERSION
JWT_SECRET, ENCRYPTION_KEY
REDIS_URL
CORS_ORIGIN
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY    # S3 + SES
```

See `src/config/validation.schema.ts` for the full Joi schema.

## Run

```bash
npm run dev          # nest start --watch
npm run start:prod   # node dist/main
npm run test         # jest
```

## Migrations

TypeORM CLI with the data source at `src/database/migrations/data-source.ts`:

```bash
npm run migration:run
npm run migration:revert
npm run migration:generate -- src/database/migrations/<Name>
```

## Seed (dev only)

```bash
npm run seed:dev
```

Inserts one user, customer, payment method, payment intent, setup intent,
and subscription. Idempotent — keyed by `seed@example.com`.
