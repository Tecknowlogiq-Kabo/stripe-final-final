# stripe-integration

Monorepo for a Stripe integration: a NestJS API, a separate NestJS webhooks
service, and a Next.js frontend. Persistence is Oracle XE; queue/cache is Redis.

## Apps

| Path | Name | Port | Purpose |
|---|---|---|---|
| `apps/api` | `@stripe-integration/api` | 3001 | Public REST API (NestJS) |
| `apps/webhooks` | `@stripe-integration/webhooks` | 3003 | Stripe webhook receiver (NestJS) |
| `apps/web` | `@stripe-integration/web` | 3000 | Customer-facing UI (Next.js 14) |

## Packages

| Path | Name | Purpose |
|---|---|---|
| `packages/shared-types` | `@repo/shared-types` | Cross-app TypeScript entity types |

## Prerequisites

- Node.js 20.x
- npm 10.x (workspaces)
- Docker + Docker Compose (Oracle XE, Redis, observability stack)
- Stripe account with API keys (test mode for local)

## Quick start

```bash
docker-compose up -d        # Oracle XE, Redis, OTel collector
npm ci                       # Install all workspaces
npm run dev                  # Turbo runs every app's dev script
```

Apply schema and seed dev data:

```bash
npm run migration:run --workspace=apps/api
npm run seed:dev --workspace=apps/api
```

## Common scripts

- `npm run build` — turbo-build every workspace
- `npm run test` — turbo-test every workspace
- `npm run lint` — turbo-lint every workspace
- `npm run docker:up` / `docker:down` / `docker:down:volumes`

## Environment

Top-level `turbo.json` `globalEnv` lists the variables forwarded into tasks:
Oracle credentials, Stripe keys, and frontend public keys. See each app's
README for app-specific variables.
