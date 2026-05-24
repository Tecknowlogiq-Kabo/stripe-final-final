# Module Portability Guide

This document describes what you need to copy each NestJS module into another project.

---

## Billing

### Files to copy
- `apps/api/src/billing/` (entire folder)
- `apps/api/src/entities/billing-record.entity.ts`
- `apps/api/src/entities/notification.entity.ts`
- `apps/api/src/entities/stripe-subscription.entity.ts`
- `apps/api/src/entities/stripe-customer.entity.ts`

### Peer dependencies
- `StripeModule` (`apps/api/src/stripe/`) — used for payment intent creation
- `@nestjs/schedule` — `BillingService` uses `@Cron` decorators

### Required env vars
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_API_VERSION=2026-03-25.dahlia
```

### Migration file
`apps/api/src/database/migrations/009-billing-records-notifications.ts`
Creates: `BILLING_RECORDS`, `NOTIFICATIONS`

Prerequisite tables (`STRIPE_SUBSCRIPTIONS`, `STRIPE_CUSTOMERS`) are created by:
`apps/api/src/database/migrations/001-initial-schema.ts`

### How to wire
```typescript
imports: [BillingModule]
```

---

## Subscriptions

### Files to copy
- `apps/api/src/subscriptions/` (entire folder)
- `apps/api/src/entities/stripe-subscription.entity.ts`
- `apps/api/src/entities/stripe-customer.entity.ts`
- `apps/api/src/entities/subscription-plan.entity.ts`

### Peer dependencies
- `CustomersModule` (`apps/api/src/customers/`) — used to look up / create Stripe customers
- `StripeModule` (`apps/api/src/stripe/`) — subscription CRUD against Stripe API
- `RedisModule` / `RedisService` (`apps/api/src/redis/`) — plan-list caching

### Required env vars
```
STRIPE_SECRET_KEY=
STRIPE_API_VERSION=2026-03-25.dahlia
REDIS_URL=redis://localhost:6379
```

### Migration file
`apps/api/src/database/migrations/001-initial-schema.ts`
Creates: `STRIPE_SUBSCRIPTIONS`, `STRIPE_CUSTOMERS`, `SUBSCRIPTION_PLANS`

`apps/api/src/database/migrations/007-add-subscription-plan-fk.ts`
Adds FK from `STRIPE_SUBSCRIPTIONS` to `SUBSCRIPTION_PLANS`

### How to wire
```typescript
imports: [SubscriptionsModule]
```

---

## TrustID

### Files to copy
- `apps/api/src/trustid/` (entire folder including `dto/`)

### Peer dependencies
- `TrustModule` (`apps/api/src/trust/`) — circular ref via `forwardRef`
- `@nestjs/axios` / `HttpModule` — all TrustID Cloud API calls use `HttpService`
- `@nestjs/config` / `ConfigService` — reads all `trustid.*` config keys

### Required env vars
```
TRUSTID_API_BASE_URL=https://api.trustid.co.uk
TRUSTID_API_KEY=
TRUSTID_USERNAME=
TRUSTID_PASSWORD=
TRUSTID_SESSION_TTL_SECONDS=3600
TRUSTID_WEBHOOK_CALLBACK_BASE_URL=
TRUSTID_WEBHOOK_SECRET=
CORS_ORIGIN=http://localhost:3000
```

### Migration file
No dedicated migration — TrustID is a stateless HTTP integration; no tables.

### How to wire
```typescript
imports: [TrustIdModule]
```
`TrustIdModule` is `@Global()`, so `TrustIdService` is available project-wide once imported in `AppModule`.

---

## Trust

### Files to copy
- `apps/api/src/trust/` (entire folder)
- `apps/api/src/entities/trust-token.entity.ts`

### Peer dependencies
- `S3Module` (`apps/api/src/s3/`) — document upload/download
- `TrustIdModule` (`apps/api/src/trustid/`) — guest link creation
- `EmailModule` (`apps/api/src/email/`) — notification emails
- `AuditService` (`apps/api/src/audit/`) — audit log writes
- `RedisService` (`apps/api/src/redis/`) — token caching
- `@nestjs/jwt` / `JwtModule` — trust token signing and verification

### Required env vars
```
TRUST_JWT_SECRET=          # falls back to JWT_SECRET
JWT_SECRET=
TRUST_TOKEN_TTL_SECONDS=86400
TRUST_GUEST_LINK_BASE_URL=http://localhost:3000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=stripe-trust-files
S3_TRUST_PREFIX=trust-approved/
EMAIL_FROM=noreply@yourdomain.com
```

### Migration file
`TRUST_TOKENS` table is not yet present in any numbered migration. Add a new migration that creates:
```sql
CREATE TABLE TRUST_TOKENS (
  ID           VARCHAR2(36)   NOT NULL,
  TOKEN_HASH   VARCHAR2(128)  NOT NULL,
  RESOURCE_TYPE VARCHAR2(50)  NOT NULL,
  RESOURCE_ID  VARCHAR2(100),
  STATUS       VARCHAR2(20)   DEFAULT 'pending' NOT NULL,
  EXPIRES_AT   TIMESTAMP      NOT NULL,
  USER_ID      VARCHAR2(36),
  CREATED_BY   VARCHAR2(100),
  METADATA     VARCHAR2(4000),
  CREATED_AT   TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  UPDATED_AT   TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT PK_TRUST_TOKENS PRIMARY KEY (ID),
  CONSTRAINT UQ_TRUST_TOKEN_HASH UNIQUE (TOKEN_HASH)
)
```

### How to wire
```typescript
imports: [TrustModule]
```

---

## S3

### Files to copy
- `apps/api/src/s3/` (entire folder)

### Peer dependencies
- `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` npm packages
- `@nestjs/config` / `ConfigService` — reads `aws.*` config keys

### Required env vars
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET=stripe-trust-files
S3_TRUST_PREFIX=trust-approved/
```

### Migration file
None — S3 is a stateless AWS service integration; no tables.

### How to wire
```typescript
imports: [S3Module]
```
`S3Module` is `@Global()`, so `S3Service` is available project-wide once imported in `AppModule`.

---

## Email

### Files to copy
- `apps/api/src/email/` (entire folder)

### Peer dependencies
- `@aws-sdk/client-ses` npm package
- `@nestjs/config` / `ConfigService` — reads `email.*` config keys

### Required env vars
```
EMAIL_FROM=noreply@yourdomain.com
EMAIL_AWS_REGION=us-east-1   # falls back to AWS_REGION
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

### Migration file
None — email is a stateless AWS SES integration; no tables.

### How to wire
```typescript
imports: [EmailModule]
```
`EmailModule` is `@Global()`, so `EmailService` is available project-wide once imported in `AppModule`.

---

## Auth

### Files to copy
- `apps/api/src/auth/` (entire folder including `dto/` and `strategies/`)
- `apps/api/src/entities/user.entity.ts`

### Peer dependencies
- `passport` and `@nestjs/passport` npm packages
- `@nestjs/jwt` / `JwtModule` — JWT signing and verification (re-exported by `AuthModule`)
- `bcrypt` npm package — password hashing in `AuthService`
- `@nestjs/config` / `ConfigService` — reads `jwt.*` config keys

### Required env vars
```
JWT_SECRET=
JWT_PREVIOUS_SECRET=   # optional — used during secret rotation
```
`JWT_EXPIRES_IN` is hardcoded to `15m` in `configuration.ts`.

### Migration file
`apps/api/src/database/migrations/003-add-users-table.ts`
Creates: `APP_USERS`

### How to wire
```typescript
imports: [AuthModule]
```
