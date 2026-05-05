# Deployment Readiness

**Assessed:** 2026-05-05  
**Verdict: NOT READY FOR PRODUCTION** — 3 P0 blockers must be resolved first.

---

## Blockers

| # | Blocker | File | Impact |
|---|---------|------|--------|
| B1 | Redis failures crash cached endpoints (no circuit breaker) | `redis/redis.service.ts` | HTTP 500 on every customer/plans lookup if Redis restarts |
| B2 | NEXT_PUBLIC_DEMO_CUSTOMER_ID hardcoded for all users | `web/src/app/payment-methods/page.tsx` | All users see/manage the same customer's payment data |
| B3 | No refresh tokens — users silently lose session after 15 min | `auth/auth.service.ts` | Unusable in production without token refresh |

These three must be fixed before any real traffic. Everything else below is how to proceed once they're resolved.

---

## Pre-Deployment Checklist

### Infrastructure

- [ ] Redis container running and healthy (`redis-cli ping` → `PONG`)
- [ ] Oracle XE 21c accessible from API container on port 1521
- [ ] Oracle service name is `XEPDB1` (pluggable DB, **not** `XE`)
- [ ] Jaeger or equivalent APM running for traces

### Migrations

Run in order — all four must succeed before starting the API:

```bash
cd apps/api

# 001: Initial schema (all tables + FKs)
npm run migration:run

# 002: Missing indexes + webhook UPDATED_AT column
npm run migration:run

# 003: APP_USERS table for authentication
npm run migration:run

# 004: Expand payment methods + payment intents + setup intents
npm run migration:run

# Verify
# Connect to Oracle and run:
# SELECT TABLE_NAME, NUM_ROWS FROM USER_TABLES ORDER BY TABLE_NAME;
# SELECT INDEX_NAME, TABLE_NAME FROM USER_INDEXES ORDER BY TABLE_NAME;
```

### Environment Variables (API)

| Variable | Example | Required | Notes |
|----------|---------|----------|-------|
| `NODE_ENV` | `production` | No | Controls Swagger (dev-only), log format |
| `PORT` | `3001` | No | Default: 3001 |
| `ORACLE_USER` | `stripe_app` | **Yes** | Use least-privilege account |
| `ORACLE_PASSWORD` | *(secret)* | **Yes** | Store in secrets manager |
| `ORACLE_HOST` | `oracle` | **Yes** | Docker service name or RDS host |
| `ORACLE_PORT` | `1521` | No | Default: 1521 |
| `ORACLE_SERVICE_NAME` | `XEPDB1` | No | Must be pluggable DB, not SID |
| `STRIPE_SECRET_KEY` | `sk_live_...` | **Yes** | Pattern validated: `sk_(test\|live)_*` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | **Yes** | From Stripe Dashboard → Webhooks |
| `CORS_ORIGIN` | `https://app.example.com` | **Yes** | Exact match, no trailing slash |
| `JWT_SECRET` | *(min 32 chars)* | **Yes** | `openssl rand -base64 48` |
| `REDIS_URL` | `redis://redis:6379` | No | Default: `redis://localhost:6379` |
| `LOG_LEVEL` | `info` | No | Default: info |
| `THROTTLE_TTL` | `60` | No | Seconds |
| `THROTTLE_LIMIT` | `100` | No | Requests per TTL |

### Environment Variables (Frontend)

| Variable | Example | Required | Notes |
|----------|---------|----------|-------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | **Yes** | Safe to expose |
| `NEXT_PUBLIC_API_URL` | `https://api.example.com` | **Yes** | Browser-accessible API URL |
| `API_URL` | `http://api:3001` | **Yes** | Server-side (Docker internal network) |
| `NEXT_PUBLIC_DEMO_CUSTOMER_ID` | *(remove)* | **Remove** | Must be removed before production |

### Stripe Configuration

1. Go to Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-api-host/api/v1/webhooks/stripe`
3. Select these events:

```
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
payment_intent.processing
payment_intent.requires_action
setup_intent.succeeded
setup_intent.setup_failed
setup_intent.canceled
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.trial_will_end
customer.subscription.paused
customer.subscription.resumed
invoice.payment_succeeded
invoice.payment_failed
invoice.upcoming
invoice.created
invoice.finalized
payment_method.attached
payment_method.detached
payment_method.updated
customer.created
customer.updated
customer.deleted
mandate.updated
```

4. Copy the signing secret → set `STRIPE_WEBHOOK_SECRET`

---

## Build and Start

```bash
# Install
npm ci

# Build (Turborepo runs api + web in parallel)
npx turbo run build

# Start production stack
docker compose up -d

# Health check
curl https://your-api-host/api/v1/health
# Expected:
# {
#   "status": "ok",
#   "info": {
#     "oracle-database": { "status": "up" },
#     "stripe-api": { "status": "up" },
#     "redis": { "status": "up" }
#   }
# }
```

---

## Security Verification

```bash
# 1. Endpoints require authentication
curl https://api.example.com/api/v1/customers
# → 401 Unauthorized

# 2. Webhook accepts unauthenticated (uses Stripe sig)
curl -X POST https://api.example.com/api/v1/webhooks/stripe
# → 400 Bad Request (missing/invalid signature), NOT 401

# 3. Body size limit
python3 -c "print('x' * 200000)" | curl -X POST \
  -H "Content-Type: application/json" -d @- \
  https://api.example.com/api/v1/customers
# → 413 Payload Too Large

# 4. Security headers present on API
curl -I https://api.example.com/api/v1/health | grep -i "content-security-policy\|x-frame-options\|strict-transport"

# 5. Health endpoint public
curl https://api.example.com/api/v1/health
# → 200 OK (no auth required)

# 6. Swagger hidden in production
curl https://api.example.com/api/docs
# → 404 Not Found
```

---

## Monitoring Setup (Minimum for Production)

| Concern | Tool | Priority |
|---------|------|----------|
| Error tracking | Sentry (`@sentry/nestjs` + `@sentry/nextjs`) | P1 — required |
| Metrics | Prometheus + Grafana via `@willsoto/nestjs-prometheus` | P1 — required |
| Distributed traces | SigNoz or Grafana Tempo (replace dev Jaeger) | P2 |
| Uptime | Health endpoint behind ALB/k8s liveness probe | P1 — required |
| Log shipping | Ship Pino JSON to CloudWatch / Datadog / Loki | P1 — required |
| Alerting | PagerDuty / Opsgenie on error rate, p95 latency, DB pool | P2 |

---

## Known Gaps (Do Not Ship Without Addressing)

| Priority | Gap | Impact |
|----------|-----|--------|
| **P0** | Redis circuit breaker missing | Redis blip → cascade 500s on customer endpoints |
| **P0** | Demo customer ID hardcoded in frontend | All users share one customer's data |
| **P0** | No refresh tokens | Users locked out after 15 minutes |
| P1 | User→customer ownership not enforced | Any user can read any customer's data |
| P1 | No database transactions on Stripe+DB writes | Stripe resource created, DB record missing on DB failure |
| P1 | In-memory rate limiter fails with multiple replicas | Limits not enforced across horizontal scale |
| P1 | STRIPE_SUBSCRIPTIONS has no FK to SUBSCRIPTION_PLANS | Plan deletion orphans subscription records |
| P2 | No test coverage | Zero confidence in regressions |
| P2 | No CI/CD pipeline | Manual deployments, no automated quality gate |
| P2 | LOG_FORMAT not in Joi validation schema | Silent misconfiguration |
| P2 | Email uniqueness is index-only, not constraint | Race condition on concurrent customer creation |
