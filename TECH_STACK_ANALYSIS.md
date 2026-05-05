# Tech Stack Analysis

**Project:** Stripe Payment Integration — NestJS + Next.js Monorepo  
**Reviewed:** 2026-05-05 (full stack audit)  
**Analyst:** Principal Full-Stack Engineer  

---

## Monorepo Structure

```
stripe-final-final/
├── apps/
│   ├── api/          NestJS 10 backend (port 3001)
│   └── web/          Next.js 14 App Router frontend (port 3000)
├── packages/
│   └── shared-types/ Shared TypeScript type definitions
├── turbo.json        Turborepo pipeline
└── docker-compose.yml
```

Build system: Turborepo v2 — parallel builds across workspaces.

---

## Full Stack Inventory

```json
{
  "frontend": {
    "framework": "Next.js 14.2.21 (App Router, standalone output)",
    "language": "TypeScript 5.6.3",
    "stateManagement": "Redux Toolkit 2.11.2 + RTK Query",
    "styling": "Tailwind CSS 3.4.16",
    "payments": "@stripe/react-stripe-js 2.9.0 + @stripe/stripe-js 4.10.0",
    "testing": "NONE — zero test coverage on frontend"
  },
  "backend": {
    "runtime": "Node.js 20 (Alpine in Docker)",
    "framework": "NestJS 10.4.7",
    "language": "TypeScript 5.6.3",
    "validation": "class-validator 0.14 + Joi (env vars)",
    "auth": "Passport JWT — 15-minute tokens, NO refresh tokens",
    "hashing": "bcrypt 5.1.1 (12 rounds)",
    "rateLimit": "@nestjs/throttler 6.3.0 — in-memory store (fails at 2+ replicas)"
  },
  "database": {
    "primary": "Oracle XE 21c (gvenzl/oracle-xe:21-slim)",
    "driver": "oracledb 6.7.0 (thin mode — no Instant Client)",
    "orm": "TypeORM 0.3.20 — entities for typing, all queries are raw SQL",
    "migrations": "4 migrations, manual run required",
    "connectionPool": "min 2, max 10, ping every 60s"
  },
  "cache": {
    "store": "Redis 7-alpine (ioredis 5.10.1)",
    "ttl": "customers 300s, plans 3600s",
    "persistence": "NONE — ephemeral container, no volume"
  },
  "observability": {
    "tracing": "OpenTelemetry auto-instrumentation + Jaeger all-in-one 1.62",
    "logging": "Pino via nestjs-pino — structured JSON, correlation IDs",
    "health": "@nestjs/terminus — Oracle + Stripe API + Redis",
    "metrics": "NONE — no Prometheus endpoint"
  },
  "payments": {
    "sdk": "stripe 17.4.0",
    "apiVersion": "2025-04-30",
    "webhookVerification": "HMAC via constructEvent() on raw body",
    "idempotency": "per-request UUID header, stored in DB for customers + PIs"
  },
  "security": {
    "headers": "Helmet 8 (API) + next.config.mjs headers() (frontend)",
    "cors": "single string origin — no multi-origin support",
    "csp_api": "Stripe domains scoped; no unsafe-inline on API (JSON-only)",
    "csp_frontend": "unsafe-inline in script-src — known gap"
  },
  "infrastructure": {
    "compose_services": ["oracle (healthcheck)", "redis (healthcheck)", "api", "web", "jaeger"],
    "api_startup_order": "waits for oracle+redis+jaeger healthy/started",
    "production_compose": "NONE — same compose file used for dev and would be used in prod"
  }
}
```

---

## Architectural Decisions

| Decision | Choice | Verdict |
|----------|--------|---------|
| Database | Oracle XE 21c | ⚠️ Heavy; license-constrained in production. PostgreSQL would be simpler. |
| ORM style | TypeORM entities + raw SQL everywhere | ✅ Best of both worlds |
| Migrations | Manual CLI — `synchronize: false` | ✅ Production-safe |
| Auth | Stateless JWT, 15-minute tokens, no refresh | ❌ Unusable UX in production |
| Payment UI | `redirect: 'if_required'` | ✅ Users stay in-app for card flows |
| Webhook body | `rawBody: true` + HMAC verify | ✅ Correct approach |
| Idempotency | Header-driven + DB storage | ✅ Durable deduplication |
| Throttle | Named tiers (default 100/m, payment 20/m) | ⚠️ In-memory — fails with multiple API instances |
| Caching | Cache-aside with Redis (customers, plans) | ✅ Correct pattern, TTLs sensible |
| Cache resilience | No circuit breaker on Redis calls | ❌ Redis failure crashes cached endpoints |
| Tracing | OTel auto-instrumentation + Jaeger | ✅ Good for dev; needs SigNoz/Tempo for prod |
| Frontend state | RTK Query + Redux | ✅ Solid; server actions for sensitive writes |

---

## Stripe Integration Surface

| Feature | Endpoint(s) | Status |
|---------|-------------|--------|
| Customers | `POST/GET/PATCH/DELETE /api/v1/customers` | ✅ |
| Payment Intents | `POST/GET/PATCH/DELETE /api/v1/payment-intents` | ✅ |
| Setup Intents | `POST/GET/DELETE /api/v1/setup-intents` | ✅ |
| Payment Methods | `GET/DELETE/PATCH /api/v1/payment-methods` | ✅ |
| Subscriptions | `POST/GET/PATCH/DELETE /api/v1/subscriptions` | ✅ |
| Webhooks | `POST /api/v1/webhooks/stripe` | ✅ HMAC verified |
| Reporting | `GET /api/v1/reports/*` | ✅ 7 analytics endpoints |
| Health | `GET /api/v1/health` | ✅ Oracle + Stripe + Redis |

---

## Database Schema (8 Entities)

| Table | Purpose | Notable Issues |
|-------|---------|----------------|
| `STRIPE_CUSTOMERS` | Customer master | Email unique index only, not constraint — race condition possible |
| `STRIPE_PAYMENT_INTENTS` | Payment transactions | Idempotency key stored ✅ |
| `STRIPE_SETUP_INTENTS` | Save payment methods | Idempotency key stored ✅ |
| `STRIPE_PAYMENT_METHODS` | Saved cards/wallets | No FK from SUBSCRIPTIONS.DEFAULT_PM_ID |
| `STRIPE_SUBSCRIPTIONS` | Recurring billing | No FK to SUBSCRIPTION_PLANS — plan deletion is not constrained |
| `STRIPE_WEBHOOK_EVENTS` | Webhook dedup/audit | CLOB payload, retry count, status tracking ✅ |
| `SUBSCRIPTION_PLANS` | Price/product cache | No FK from subscriptions — data integrity gap |
| `APP_USERS` | Authentication | No FK to STRIPE_CUSTOMERS — separate user system, ownership unverified |

---

## Environment Variables

### API (`apps/api/.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_ENV` | No (default: `development`) | Controls Swagger, log format |
| `PORT` | No (default: `3001`) | |
| `ORACLE_USER` | Yes | |
| `ORACLE_PASSWORD` | Yes | |
| `ORACLE_HOST` | Yes | Use `oracle` inside Docker |
| `ORACLE_PORT` | No (default: `1521`) | |
| `ORACLE_SERVICE_NAME` | No (default: `XEPDB1`) | Must be pluggable DB, NOT `XE` |
| `STRIPE_SECRET_KEY` | Yes | Pattern: `sk_(test\|live)_*` |
| `STRIPE_WEBHOOK_SECRET` | Yes | Pattern: `whsec_*` |
| `CORS_ORIGIN` | Yes | Single origin string |
| `JWT_SECRET` | Yes | Min 32 chars |
| `REDIS_URL` | No (default: `redis://localhost:6379`) | Use `redis://redis:6379` in Docker |
| `LOG_LEVEL` | No (default: `info`) | |
| `THROTTLE_TTL` | No (default: `60`) | Seconds |
| `THROTTLE_LIMIT` | No (default: `100`) | Requests per TTL |

**Note:** `LOG_FORMAT` is read in `configuration.ts` but is NOT in the Joi validation schema — silent misconfiguration risk.

### Frontend (`apps/web/.env.local`)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Safe to expose |
| `NEXT_PUBLIC_API_URL` | Yes | Client-side API URL |
| `API_URL` | Yes | Server-side internal URL |
| `NEXT_PUBLIC_DEMO_CUSTOMER_ID` | Yes (currently) | **Demo artifact — production-breaking** |
