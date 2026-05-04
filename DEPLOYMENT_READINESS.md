# Deployment Readiness

## Pre-Deployment Checklist

### Database
- [ ] Oracle XE 21c accessible from API container
- [ ] Service name is `XEPDB1` (pluggable DB, NOT `XE`)
- [ ] Run migration 001: `npm run migration:run` in `apps/api`
- [ ] Run migration 002: `npm run migration:run` in `apps/api` (missing indexes + webhook `UPDATED_AT`)
- [ ] Run migration 003: `npm run migration:run` in `apps/api` (APP_USERS table for JWT auth)
- [ ] Verify all indexes: `SELECT INDEX_NAME FROM USER_INDEXES ORDER BY TABLE_NAME, INDEX_NAME`

### Environment Variables (API)

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Controls logging format, Swagger visibility |
| `PORT` | `3001` | |
| `ORACLE_USER` | `stripe_app` | Least-privilege DB user |
| `ORACLE_PASSWORD` | *(secret)* | Rotate regularly |
| `ORACLE_HOST` | `oracle` | Docker service name |
| `ORACLE_PORT` | `1521` | |
| `ORACLE_SERVICE_NAME` | `XEPDB1` | Must be pluggable DB, not SID |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Live key for production |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe Dashboard → Webhooks |
| `CORS_ORIGIN` | `https://app.example.com` | Exact frontend origin |
| `JWT_SECRET` | *(min 32 chars)* | Use `openssl rand -base64 48` to generate |
| `LOG_LEVEL` | `info` | |
| `THROTTLE_TTL` | `60` | Seconds |
| `THROTTLE_LIMIT` | `100` | Requests per TTL (default throttler) |

### Environment Variables (Frontend)

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | Safe to expose to browser |
| `NEXT_PUBLIC_API_URL` | `https://api.example.com` | Browser-visible API URL |
| `API_URL` | `http://api:3001` | Server-side internal URL (Docker network) |

### Pre-Start Requirements

```bash
# Create logs directory (Winston file transports write here)
mkdir -p apps/api/logs

# Install dependencies
npm ci

# Build all packages
npx turbo run build

# Run all migrations
cd apps/api && npm run migration:run
```

### Stripe Configuration

- [ ] Register webhook endpoint in Stripe Dashboard: `https://api.example.com/api/v1/webhooks/stripe`
- [ ] Select webhook events:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `setup_intent.succeeded`
  - `setup_intent.setup_failed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.updated`
  - `payment_method.attached`
  - `payment_method.detached`
- [ ] Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### Docker Production Build

```bash
# Build API
docker build -t stripe-api:latest ./apps/api

# Build Web
docker build -t stripe-web:latest ./apps/web

# Start stack
docker-compose -f docker-compose.yml up -d
```

---

## Security Verification

```bash
# API security headers
curl -I http://localhost:3001/api/v1/health

# Frontend security headers
curl -I http://localhost:3000

# Verify no endpoints are accessible without auth
curl http://localhost:3001/api/v1/customers
# Expected: 401 Unauthorized

# Verify webhook is accessible without auth (uses Stripe signature)
curl -X POST http://localhost:3001/api/v1/webhooks/stripe
# Expected: 400 Bad Request (missing signature), NOT 401

# Verify body size limit
python3 -c "print('x' * 200000)" | curl -X POST \
  -H "Content-Type: application/json" \
  -d @- http://localhost:3001/api/v1/customers
# Expected: 413 Payload Too Large
```

---

## Health Checks

| Endpoint | Auth Required | Purpose |
|---|---|---|
| `GET /api/v1/health` | No | Liveness + DB + Stripe connectivity |
| `GET /api/v1/health/liveness` | No | Container alive check |

---

## Monitoring Recommendations

| Concern | Tool |
|---|---|
| Error tracking | Sentry (`@sentry/nestjs` + `@sentry/nextjs`) |
| Metrics | Prometheus + Grafana (expose `/metrics` via `@willsoto/nestjs-prometheus`) |
| Logs | Ship `logs/combined.log` to CloudWatch / Datadog / Loki |
| Uptime | Healthcheck endpoint behind ALB or Kubernetes probe |

---

## Known Limitations / Not Yet Implemented

| Item | Impact | Notes |
|---|---|---|
| Refresh tokens | Users logged out after 15 min JWT expiry | Implement refresh token rotation |
| Ownership verification | Any authenticated user can read any customer's data | Add user → customer scoping |
| Caching | Plans loaded from DB on every request | Add Redis cache with short TTL |
| E2E tests | No Playwright/Cypress tests | Add before going to production |
| HTTPS redirect | HTTP not redirected to HTTPS | Configure at load balancer / reverse proxy level |
