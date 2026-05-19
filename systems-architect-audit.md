# Observability Architecture & Telemetry Pipeline Audit

**Auditor:** Senior Systems Architect  
**Date:** 2026-05-19  
**Scope:** `apps/api` — NestJS Stripe payments backend  
**Deployment model:** EC2 + PM2 (stated) / Docker Compose (implemented)  
**Observability target:** LGTM stack (requested) / SigNoz (per CONTEXT.md)

---

## Executive Summary

The observability foundation is **well-structured at the application level** — OpenTelemetry tracing, structured Pino logging with correlation IDs, Prometheus metrics, Sentry error tracking, and BullMQ-aware processing are all present. However, the pipeline is **severely incomplete at the infrastructure level**. The application produces telemetry signals correctly, but **nothing collects, stores, or visualizes them** in production. The docker-compose setup drops Jaeger without replacing it, there is no log shipper, no Prometheus server, no Grafana, and no alerting rules.

Additionally, there is a **fundamental architectural conflict**: `CONTEXT.md` (the domain context document) declares SigNoz as the production observability backend, while the task specifies an LGTM stack (Loki, Grafana, Tempo, Mimir/Prometheus), and the code is configured for Jaeger (dev) / Tempo (prod target). This ambiguity must be resolved before any infrastructure work begins.

**Overall grade: C+** — Strong application instrumentation, missing collection/storage/visualization layer.

---

## 1. Complete Telemetry Signal Flow Map

### 1.1 Logs

```
[App Code]
    │  Logger.log() / Logger.error() / Logger.warn()
    ▼
[nestjs-pino / PinoLoggerModule]  (apps/api/src/logging/logger.module.ts)
    │
    ├── genReqId: req.id (set by CorrelationIdMiddleware) or new UUIDv4
    ├── mixin: OTel traceId + spanId injected into every log record
    ├── redact: authorization, cookie, stripe-signature, email/token query params
    ├── serializers: req → { id, method, url, remoteAddress }
    │
    ├── DEV (NODE_ENV !== 'production'):
    │   └── pino-pretty → stdout
    │
    └── PROD:
        ├── pino/file → stdout (PID 1 captures)
        ├── pino-roll → logs/error.log    (10MB × 5 files, errors only)
        └── pino-roll → logs/combined.log  (50MB × 5 files, all levels)
```

**Key details:**
- `CorrelationIdMiddleware` (`apps/api/src/common/middleware/correlation-id.middleware.ts`) runs first, sets `req.id` from `x-correlation-id` / `x-request-id` header or generates UUIDv4. This is picked up by pino-http's `genReqId`.
- OTel trace/span injection is done at log-emission time via pino's `mixin()`, which calls `trace.getActiveSpan()`. This is correct and creates no static coupling.
- `sanitize.ts` provides helper functions (`sanitizeFields`, `maskEmail`, `sanitizePath`) but these are used manually in filters, not automatically in pino serializers.
- The `redact` paths in pino config only cover specific HTTP headers. Sensitive fields in log message objects (passwords, API keys in structured logs) are NOT automatically redacted — `sanitizeFields()` must be called explicitly.

### 1.2 Traces

```
[main.ts line 1]
    │  import './instrumentation'  ← MUST be first; patches Node internals
    ▼
[NodeSDK]  (apps/api/src/instrumentation.ts)
    │
    ├── serviceName: OTEL_SERVICE_NAME || 'stripe-api'
    ├── traceExporter: OTLPTraceExporter (HTTP/protobuf)
    │   └── endpoint: OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces
    │       default: http://localhost:4318/v1/traces
    │
    ├── instrumentations: getNodeAutoInstrumentations({
    │       '@opentelemetry/instrumentation-fs': { enabled: false }
    │   })
    │   └── Auto-instruments: HTTP, Express, gRPC, net, DNS, etc.
    │       (fs disabled to reduce noise)
    │
    └── Graceful shutdown: SIGTERM → sdk.shutdown()
```

**Auto-instrumented libraries via `getNodeAutoInstrumentations`:**
- `@opentelemetry/instrumentation-http` — HTTP client/server spans
- `@opentelemetry/instrumentation-express` — Express route spans
- `@opentelemetry/instrumentation-nestjs-core` — NestJS guard/interceptor/pipe spans
- `@opentelemetry/instrumentation-ioredis` — Redis command spans
- `@opentelemetry/instrumentation-pg` / `oracledb` — Database spans
- Plus: DNS, net, grpc, etc.

**What's NOT instrumented:**
- **BullMQ job processing** — WebhookProcessor.process() has no custom span wrapping. BullMQ jobs run in a separate context and won't inherit the HTTP request span. This means webhook processing traces are disconnected from the incoming Stripe webhook request.
- **Stripe SDK calls** — No OTel instrumentation for the `stripe` npm package. Custom spans are needed around `this.stripe.paymentIntents.create()` etc.
- **TypeORM/Oracle queries** — While `@opentelemetry/instrumentation-pg` would auto-instrument PostgreSQL, Oracle DB uses `oracledb` driver. The auto-instrumentations may not capture Oracle queries properly.

### 1.3 Metrics

```
[AppModule providers]
    │  APP_INTERCEPTOR: MetricsInterceptor
    ▼
[MetricsInterceptor]  (apps/api/src/common/interceptors/metrics.interceptor.ts)
    │  Every HTTP request
    │  start = Date.now()
    ├── next() success → recordRequestDuration(method, route, statusCode, duration)
    └── error → recordRequestDuration + recordError(method, route, statusCode)

[MetricsService]  (apps/api/src/metrics/metrics.service.ts)
    │
    ├── collectDefaultMetrics({ prefix: 'stripe_' })
    │   └── Node.js runtime: event loop lag, GC, heap, active handles,
    │       CPU, file descriptors, process memory
    │
    ├── stripe_http_request_duration_seconds  (Histogram)
    │   labels: method, route, status_code
    │   buckets: 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
    │
    ├── stripe_http_errors_total              (Counter)
    │   labels: method, route, status_code
    │
    └── stripe_http_requests_total            (Counter)
        labels: method, route, status_code

[MetricsController]  (apps/api/src/metrics/metrics.controller.ts)
    │  GET /metrics  (NO AUTH — public endpoint)
    └── Content-Type: text/plain → register.metrics()
```

**🚨 High-cardinality risk:** The `route` label uses `request.route?.path` (e.g., `/api/v1/customers/:id`). This is correct (parameterized path), not the raw URL. However, any route not registered via Express router will get `route: 'unknown'` — all of those collapse into a single label value, which is noisy but not dangerous.

**Missing:** No security on `/metrics` endpoint. Anyone can scrape process memory, request counts, and error rates. In production, this should be firewalled or behind basic auth.

### 1.4 Sentry

```
[main.ts bootstrap()]
    │  configService.get('sentry.dsn')
    ├── DSN present → Sentry.init({
    │       dsn, environment, tracesSampleRate: prod ? 0.1 : 1.0
    │   })
    └── DSN absent → no-op (graceful)
```

- `@sentry/nestjs` is imported but only `Sentry.init()` from `@sentry/node` is called explicitly. The `@sentry/nestjs` integration (which wraps NestJS exception filters, interceptors, etc.) requires `Sentry.init()` to be called first but the NestJS-specific setup (e.g., `Sentry.init({ integrations: [new Sentry.nestjsIntegration()] })`) is **missing**.
- This means Sentry catches global unhandled errors but does NOT capture NestJS-specific context (guards, pipes, interceptors) through the dedicated NestJS integration.
- **Double instrumentation risk:** Sentry's performance monitoring (`tracesSampleRate`) creates its own HTTP spans. Combined with OTel auto-instrumentation, every HTTP request generates TWO trace spans from competing systems. This wastes telemetry bandwidth and creates confusing traces.

### 1.5 Health Checks

```
[HealthController]  (apps/api/src/health/health.controller.ts)
    │  GET /health  (Public — @Public() decorator)
    └── @HealthCheck()
        ├── TypeOrmHealthIndicator.pingCheck('oracle-database')
        ├── HttpHealthIndicator.pingCheck('stripe-api', 'https://api.stripe.com/healthcheck')
        └── RedisService.ping() → 'redis': up/down
```

**🚨 Issue:** The health check calls `https://api.stripe.com/healthcheck` on **every** invocation. This endpoint does not exist — Stripe's API root (`https://api.stripe.com`) returns 200, but calling it as a health check from production generates unnecessary egress to Stripe. An ALB health check hitting every 10 seconds would make ~86,400 calls/day to Stripe's API.

**🚨 Issue:** `TypeOrmHealthIndicator.pingCheck('oracle-database')` — the `@nestjs/terminus` TypeOrmHealthIndicator runs `SELECT 1`. For Oracle via TypeORM, this may not work correctly depending on the driver configuration.

---

## 2. Architectural Gaps for Production Observability

### Gap Severity Legend

| Severity | Definition |
|----------|-----------|
| **Critical** | Production deployment impossible or catastrophically broken without this |
| **High** | Severely degrades observability; must fix before production traffic |
| **Medium** | Important but survivable temporarily; fix within first sprint |
| **Low** | Nice-to-have; addresses edge cases or operational polish |

---

| # | Gap | Severity | Detail |
|---|-----|----------|--------|
| G1 | **No log collection/shipping** | **Critical** | Pino writes JSON to `stdout` and rotating files (`logs/combined.log`, `logs/error.log`). Nothing ships these to a centralized store. Logs on the EC2 instance are ephemeral — lost on instance termination or disk failure. No Loki/Promtail/Alloy/Fluent Bit configured anywhere. |
| G2 | **No metrics collection** | **Critical** | Prometheus-formatted metrics are exposed at `/metrics` but nothing scrapes them. No Prometheus server, no Grafana Agent, no SigNoz collector. Metrics only exist in-memory in the Node.js process — restarting the app resets all counters. |
| G3 | **No trace backend in production** | **Critical** | `docker-compose.prod.yml` removes Jaeger (`profiles: [observability]`) but provides **zero replacement**. The `OTEL_EXPORTER_OTLP_ENDPOINT` env var has no default for production. Traces are either sent to a non-existent endpoint or silently dropped. |
| G4 | **No Grafana / visualization** | **Critical** | No dashboard configuration, no datasource provisioning, no Grafana instance. Telemetry data has no viewer. |
| G5 | **No alerting** | **High** | No alerting rules defined. No integration with PagerDuty/Opsgenie/Slack. Payment failures, webhook DLQ buildup, and Stripe API errors produce logs but no notifications. |
| G6 | **No SLO/SLI definitions** | **High** | No service level objectives defined. No error budgets. No uptime targets. The `/health` endpoint exists but nothing monitors it. |
| G7 | **Observability backend ambiguity** | **High** | `CONTEXT.md` line 10 states "SigNoz is the production observability backend." Docker compose targets Jaeger (dev) / Tempo (prod target per the task). LGTM stack is requested. This three-way ambiguity means teams don't know what to configure or run. |
| G8 | **No log retention policy** | **Medium** | `pino-roll` keeps 5 files of combined.log (max 250MB). No archival to S3/object storage. No compliance-driven retention windows for audit logs. |
| G9 | **No distributed tracing for BullMQ** | **Medium** | Webhook processing runs in BullMQ worker threads. No context propagation from the HTTP webhook request → BullMQ job → handler execution. Trace breaks at the queue boundary. |
| G10 | **No Stripe SDK instrumentation** | **Medium** | Stripe SDK calls (`paymentIntents.create`, `subscriptions.update`, etc.) produce no OTel spans. Stripe API latency is invisible. |
| G11 | **No Oracle DB query instrumentation** | **Medium** | Oracle queries may not be captured by auto-instrumentation (it targets PostgreSQL/MySQL drivers). TypeORM spans may be missing or incomplete. |
| G12 | **Sentry NestJS integration incomplete** | **Medium** | `@sentry/nestjs` is imported but the NestJS-specific integration (`Sentry.nestjsIntegration()`) is not registered. NestJS guard/pipe/interceptor errors miss Sentry context. |
| G13 | **No security on /metrics endpoint** | **Medium** | Process memory, request rates, and error breakdowns are publicly exposed. Competitors or attackers can profile the application's traffic patterns. |
| G14 | **Stripe health check calls Stripe API** | **Low** | Every health check hits `https://api.stripe.com`. If behind an ALB with frequent health probes, this generates unnecessary Stripe API traffic. |
| G15 | **LOG_FORMAT not validated** | **Low** | `LOG_FORMAT` env var is read in `configuration.ts` but is absent from `validation.schema.ts`. Silently ignored if misconfigured. |

---

## 3. How to Send OTel Traces to Tempo Instead of Jaeger

### What changes are needed

**Short answer: Almost nothing in the application code.** Tempo supports the OTLP protocol natively, and the application already uses `OTLPTraceExporter` with HTTP/protobuf.

### Application changes (zero code changes)

The `instrumentation.ts` file is already correct:

```typescript
// Current code — works with Tempo as-is:
traceExporter: new OTLPTraceExporter({
  url: (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318') + '/v1/traces',
}),
```

Tempo accepts OTLP over HTTP on port 4318 (`/v1/traces`) and gRPC on port 4317. The existing `OTLPTraceExporter` (HTTP) works with Tempo without modification.

**Production env change:**
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo.example.com:4318
```

### Infrastructure changes

**For Docker Compose (replace Jaeger with Tempo):**

```yaml
# In docker-compose.prod.yml or a dedicated monitoring compose:
tempo:
  image: grafana/tempo:latest
  container_name: stripe_tempo
  command: ["-config.file=/etc/tempo/tempo.yaml"]
  volumes:
    - ./infrastructure/tempo/tempo.yaml:/etc/tempo/tempo.yaml
    - tempo_data:/tmp/tempo
  ports:
    - "4317:4317"   # OTLP gRPC
    - "4318:4318"   # OTLP HTTP
  networks:
    - stripe_net

tempo_data:
  driver: local
```

**Tempo config (`infrastructure/tempo/tempo.yaml`):**
```yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: 0.0.0.0:4318
        grpc:
          endpoint: 0.0.0.0:4317

compactor:
  compaction:
    block_retention: 48h

storage:
  trace:
    backend: local
    local:
      path: /tmp/tempo/blocks
```

### Optional improvement: gRPC exporter

For production at scale, consider switching to gRPC for lower overhead:

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
// gRPC uses port 4317 by default
```

**Recommendation:** Stick with HTTP for now. The performance difference is negligible below ~1000 spans/second. The HTTP exporter has fewer dependencies and is easier to debug.

---

## 4. How to Ship Pino JSON Logs to Loki

### Current state

```
Pino → stdout (pino/file, destination: 1)
      → logs/combined.log (pino-roll, 50MB × 5 files)
      → logs/error.log   (pino-roll, 10MB × 5 files)
```

### Option analysis

| Option | EC2+PM2 Fit | Docker Fit | Complexity | Reliability |
|--------|------------|------------|------------|-------------|
| **Promtail (systemd)** | ✅ Best | ❌ N/A | Low | High — tracks file position, handles rotation |
| **Grafana Alloy (systemd)** | ✅ Good | ✅ Good | Medium | High — newer, more capable, replaces promtail |
| **Docker loki logging driver** | ❌ Not applicable | ✅ Simplest | Very Low | Medium — blocks on Loki outage unless ring-buffer |
| **Fluent Bit (systemd)** | ✅ Good | ✅ Good | Medium | High — most mature, SigNoz-compatible |
| **pino-loki (npm)** | ✅ Works | ✅ Works | Low | Low — couples app to Loki; no buffering on Loki outage |

### Recommendation by deployment model

**EC2 + PM2 (no Docker):** Install **Grafana Alloy** as a systemd service.

Alloy is Grafana's replacement for Promtail. It tails log files, enriches with EC2 metadata, and pushes to Loki. It handles pino-roll's rotation patterns (numeric suffixes: `combined.log.1`, `combined.log.2`).

```hcl
// /etc/alloy/config.alloy — on the EC2 instance
local.file_match "app_logs" {
  path_targets = [{
    __path__ = "/opt/stripe-api/logs/combined.log"
    job      = "stripe-api"
    host     = "stripe-api-prod-1"
  }, {
    __path__ = "/opt/stripe-api/logs/error.log"
    job      = "stripe-api"
    host     = "stripe-api-prod-1"
    level    = "error"
  }]
}

loki.source.file "log_files" {
  targets    = local.file_match.app_logs.targets
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki.example.com:3100/loki/api/v1/push"
  }
}
```

**Docker Compose:** Use the **loki Docker logging driver** OR **Grafana Alloy sidecar**.

Docker loki driver (simpler but blocks on Loki outage):
```yaml
api:
  logging:
    driver: loki
    options:
      loki-url: "http://loki:3100/loki/api/v1/push"
      loki-retries: 5
      loki-batch-size: "400"
```

**⚠️ Critical consideration for pino-roll:** `pino-roll` rotates files in-process. If both pino-roll AND an external agent tail the same files simultaneously, log entries may be duplicated in Loki (once from stdout, once from the file). If using a file-tailing agent (Promtail/Alloy), disable the stdout target in pino or disable the file target in the agent. **Do not ship both stdout and files to Loki.**

**Recommendation for production:**
- Use Grafana Alloy (systemd on EC2) tailing `logs/combined.log` and `logs/error.log`
- Remove the `pino/file → destination: 1` (stdout) target if it's also captured by PM2/systemd journal
- Configure Alloy to add `source: "file"` and `app: "stripe-api"` labels

---

## 5. Init-Order and Circular Dependency Analysis

### Init sequence (as-executed)

```
Time ──────────────────────────────────────────────────────────>

1. import './instrumentation'  ← FIRST LINE of main.ts
   └── NodeSDK.start() — patches http, express, ioredis, etc.
   └── OTel API ready: trace.getActiveSpan() functional

2. NestFactory.create(AppModule, { bufferLogs: false, rawBody: true })
   └── ConfigModule.forRoot() loads env vars + validation
   └── PinoLoggerModule initialized → pino-http middleware attached
   └── All @Global() modules (Metrics, Stripe, Redis, Audit) available
   └── All interceptors, guards, filters registered
   └── CorrelationIdMiddleware → RequestTimeoutMiddleware

3. app.useLogger(app.get(Logger))
   └── Swaps NestJS default logger for pino
   └── Note: bufferLogs: false means logs during bootstrap are NOT buffered

4. Sentry.init({ dsn, environment, tracesSampleRate })
   └── Sentry SDK initialized AFTER NestJS is fully created
   └── Sentry patches global error handlers

5. app.listen(port)
   └── HTTP server starts
```

### Dependency Graph

```
instrumentation.ts (OTel SDK)
        │
        │ trace.getActiveSpan() used by:
        ▼
PinoLoggerModule.mixin() ───── no import dependency, runtime call to OTel API
        │
        │ Logger used by:
        ▼
AllExceptionsFilter, StripeExceptionFilter, WebhookProcessor, StripeService, etc.
        │
        │ No dependency
        ▼
MetricsService ─────────────── independent of OTel and Pino
        │
        │ Injected into:
        ▼
MetricsInterceptor ──────────── records HTTP metrics, uses MetricsService
        │
        │ No dependency
        ▼
Sentry.init() ───────────────── separate SDK, no OTel/Pino integration
```

### Findings

| Concern | Verdict | Detail |
|---------|---------|--------|
| **OTel before Pino?** | ✅ Correct | `instrumentation.ts` imports and starts first. Pino's mixin calls `trace.getActiveSpan()` at log-emission time — OTel API is already initialized. |
| **Sentry before Pino?** | ✅ Correct | Sentry init after Pino is set up. No conflict — they serve different purposes. |
| **Sentry + OTel double-instrumentation?** | ⚠️ Problem | Sentry's `tracesSampleRate` creates HTTP spans. OTel auto-instrumentation ALSO creates HTTP spans. Every request generates spans in BOTH systems. This wastes bandwidth and creates split-brain debugging. |
| **bufferLogs: false?** | ⚠️ Minor | During bootstrap, logs emitted before `app.useLogger(app.get(Logger))` go to NestJS default logger (console), not Pino. If bootstrap fails, error context is split between two log formats. |
| **MetricsModule @Global()?** | ✅ Correct | MetricsService needs to be injectable in MetricsInterceptor (an APP_INTERCEPTOR). @Global() ensures this without explicit imports in every module. |
| **Circular dependencies?** | ✅ None | No module-level circular dependencies. Pino → OTel is a runtime API call, not an import dependency. |

### The Sentry + OTel conflict — deeper analysis

When `Sentry.init({ tracesSampleRate: 0.1 })` is called, Sentry's performance monitoring:
1. Wraps the HTTP server to create a transaction for every incoming request
2. Creates spans for outgoing HTTP calls
3. Reports these to Sentry's backend

Simultaneously, OpenTelemetry's `getNodeAutoInstrumentations()`:
1. Patches the HTTP server to create OTel spans for every incoming request
2. Patches HTTP client to create spans for outgoing calls
3. Exports these to the OTLP collector (Jaeger/Tempo)

**Result:** Each HTTP request produces TWO root spans — one in Sentry, one in Tempo. This is not a crash or error, but it's wasteful and creates divergent telemetry. A developer debugging a slow request might see it in Sentry but not Tempo (10% sample rate), or vice versa.

**Resolution options:**
1. **Recommended:** Disable Sentry performance monitoring (`tracesSampleRate: 0`), keeping Sentry for error tracking only. Let OTel handle all distributed tracing.
2. **Alternative:** Disable OTel HTTP instrumentation and let Sentry handle all tracing. (Not recommended — Sentry's trace capabilities are inferior to Tempo's.)
3. **Advanced:** Use `@sentry/opentelemetry-node` (Sentry's official OTel bridge) to unify. Configure Sentry as an OTel span processor so it receives spans from OTel instead of creating its own. This is the "right" long-term solution but adds complexity.

---

## 6. NestJS Module Ordering Analysis

### Current AppModule import order

```typescript
// apps/api/src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ... }),    // 1. Configuration (global)
    PinoLoggerModule,                                   // 2. Logging
    ThrottlerModule.forRootAsync(...),                  // 3. Rate limiting
    RedisModule,                                        // 4. Redis (@Global)
    DatabaseModule,                                     // 5. Oracle DB
    AuthModule,                                         // 6. Authentication
    StripeModule,                                       // 7. Stripe SDK (@Global)
    CustomersModule,                                    // 8. Business modules
    PaymentIntentsModule,
    SetupIntentsModule,
    PaymentMethodsModule,
    SubscriptionsModule,
    WebhooksModule,                                     // 13. Webhooks (has BullMQ)
    ReportingModule,
    HealthModule,                                       // 15. Health checks
    MetricsModule,                                      // 16. Metrics (@Global)
    AuditModule,                                        // 17. Audit (@Global)
    CryptoModule,                                       // 18. Encryption
  ],
```

### Evaluation

| Ordering Rule | Status | Detail |
|--------------|--------|--------|
| ConfigModule first | ✅ | Must be first so all modules can inject ConfigService |
| PinoLoggerModule before business modules | ✅ | Position 2 — any module importing Logger gets Pino. But since modules lazy-load providers, exact position is less critical than it seems. |
| RedisModule before ThrottlerModule | ✅ | ThrottlerModule's `useFactory` injects `RedisThrottlerStorage` from RedisModule |
| DatabaseModule before HealthModule | ✅ | HealthModule's controller injects `TypeOrmHealthIndicator` which needs the DB connection |
| MetricsModule positioning | ✅ | @Global() — position doesn't matter. But placing it after business modules means business providers are available if MetricsService ever needs them. |
| WebhooksModule imports BullModule.forRootAsync | ⚠️ Concern | BullModule is configured INSIDE WebhooksModule, but there's an `imports: [ConfigModule]` which works because ConfigModule is global. However, if another module later needs a BullMQ queue, it would need to duplicate the `forRootAsync` or the root config should be extracted to AppModule. |

### Provider ordering

```typescript
providers: [
  { provide: APP_FILTER, useClass: AllExceptionsFilter },     // 1. Catch-all
  { provide: APP_FILTER, useClass: StripeExceptionFilter },   // 2. Stripe-specific
  { provide: APP_GUARD, useClass: PerUserThrottlerGuard },    // 3. Throttle first
  { provide: APP_GUARD, useClass: JwtAuthGuard },             // 4. Auth
  { provide: APP_GUARD, useClass: RolesGuard },               // 5. Roles
  { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }, // 6. Metrics
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },   // 7. Audit
]
```

**⚠️ Filter ordering is REVERSED:** NestJS applies exception filters in reverse registration order. The LAST registered filter runs FIRST. Currently:
1. `StripeExceptionFilter` runs first (checks for `StripeError`)
2. `AllExceptionsFilter` runs second (catches everything else)

This is **correct** — more specific filters must process before generic ones. Stripe errors are caught by StripeExceptionFilter, and everything else falls through to AllExceptionsFilter.

However, NestJS docs state: "Filters are applied in the order they are bound to the app." The behavior depends on whether these are global filters (applied to every route) or method-level filters. In NestJS 10, global filters registered via `APP_FILTER` ARE applied in reverse registration order, so the current setup is correct.

### Verdict

Module ordering is **structurally sound** with no critical issues. The only improvement opportunity is extracting `BullModule.forRootAsync` to AppModule so other modules (e.g., a future email notification queue) can use it without duplication.

---

## 7. Missing Custom Metrics for a Stripe Payments API

### Current metrics

| Metric | Type | Labels | Coverage |
|--------|------|--------|----------|
| `stripe_http_request_duration_seconds` | Histogram | method, route, status_code | HTTP layer only |
| `stripe_http_errors_total` | Counter | method, route, status_code | HTTP errors only |
| `stripe_http_requests_total` | Counter | method, route, status_code | HTTP volume |
| `stripe_*` (default) | Various | N/A | Node.js runtime only |

### Missing business-critical metrics

| # | Metric Name | Type | Labels | Why It Matters | Priority |
|---|-------------|------|--------|----------------|----------|
| M1 | `stripe_payment_intents_total` | Counter | `status` (succeeded, failed, canceled, requires_action, processing) | Core business KPI — revenue depends on payment completion rate | **Critical** |
| M2 | `stripe_api_request_duration_seconds` | Histogram | `operation` (create_pi, confirm_pi, create_si, attach_pm, create_sub, etc.) | Stripe latency directly affects user experience and timeout risks | **Critical** |
| M3 | `stripe_api_errors_total` | Counter | `operation`, `error_type` (card_error, rate_limit, connection, auth, api_error) | Identifies Stripe API degradation before users report it | **Critical** |
| M4 | `stripe_webhook_events_total` | Counter | `event_type` (payment_intent.succeeded, invoice.payment_failed, etc.) | Monitors webhook delivery health — missing events = stale data | **High** |
| M5 | `stripe_webhook_processing_duration_seconds` | Histogram | `event_type` | Detects slow webhook handlers that risk Stripe retry timeouts | **High** |
| M6 | `stripe_webhook_queue_size` | Gauge | `queue` (main, dlq) | DLQ buildup indicates systemic processing failures requiring manual intervention | **High** |
| M7 | `stripe_webhook_queue_waiting` | Gauge | `queue` | Jobs waiting to be processed — alerts on processing backpressure | **High** |
| M8 | `stripe_webhook_queue_active` | Gauge | `queue` | Active job count — helps tune BullMQ concurrency | **Medium** |
| M9 | `stripe_webhook_job_duration_seconds` | Histogram | `event_type` | Individual job processing time — identifies slow event types | **Medium** |
| M10 | `stripe_webhook_job_retries_total` | Counter | `event_type` | Tracks retry frequency — high retries indicate handler fragility | **Medium** |
| M11 | `stripe_customer_cache_hit_ratio` | Gauge | N/A | Redis cache effectiveness — low hit ratio wastes Redis memory and increases Oracle load | **Medium** |
| M12 | `stripe_idempotency_key_collisions_total` | Counter | N/A | Detects duplicate requests from clients — possible retry-storm or misconfiguration | **Low** |
| M13 | `stripe_jwt_auth_failures_total` | Counter | `reason` (expired, invalid, missing, revoked) | Auth attack detection + token rotation monitoring | **Low** |
| M14 | `stripe_oracle_query_duration_seconds` | Histogram | `operation` | Database latency — Oracle is the bottleneck for most read-heavy endpoints | **Medium** |

### Implementation approach

The missing metrics should be added to the appropriate services, NOT to the generic MetricsInterceptor:

- **M1, M2, M3** → `StripeService` — wrap SDK calls with metrics recording
- **M4, M5** → `WebhooksService.processEvent()` and `WebhookProcessor.process()`
- **M6, M7, M8** → `WebhooksModule` — poll BullMQ queue stats or use BullMQ events
- **M9, M10** → `WebhookProcessor` — record in process() method
- **M11** → `RedisService` — increment hit/miss counters on get()
- **M12** → Idempotency guard/middleware (if exists)
- **M13** → `JwtAuthGuard` or `AuthService`
- **M14** → TypeORM subscriber or interceptor

### Example: StripeService instrumentation

```typescript
// In MetricsService — add new metric
this.stripeApiDuration = new Histogram({
  name: 'stripe_api_request_duration_seconds',
  help: 'Stripe API request duration',
  labelNames: ['operation', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});
this.stripeApiErrors = new Counter({
  name: 'stripe_api_errors_total',
  help: 'Stripe API errors by operation and type',
  labelNames: ['operation', 'error_type'],
});

// StripeService wrapper pattern
async createPaymentIntent(params: Stripe.PaymentIntentCreateParams) {
  const start = Date.now();
  try {
    const result = await this.stripe.paymentIntents.create(params);
    this.metrics.stripeApiDuration.observe(
      { operation: 'create_payment_intent', status: 'success' },
      (Date.now() - start) / 1000
    );
    return result;
  } catch (err) {
    this.metrics.stripeApiDuration.observe(
      { operation: 'create_payment_intent', status: 'error' },
      (Date.now() - start) / 1000
    );
    this.metrics.stripeApiErrors.inc({
      operation: 'create_payment_intent',
      error_type: err.type ?? 'unknown',
    });
    throw err;
  }
}
```

---

## 8. EC2 + PM2 Deployment: LGTM Stack Architecture

### Current reality vs. stated model

The task states "EC2 with PM2." However:
- **No PM2 config exists** (`ecosystem.config.js`, `pm2.config.js`, etc.) anywhere in the repository
- **Docker Compose files exist** for both dev and prod — the Docker-based deployment is more real than the PM2 model
- `DEPLOYMENT_READINESS.md` describes Docker Compose deployment, not PM2

This audit evaluates both models.

### Option A: Separate Monitoring EC2 Instance (Recommended)

```
┌──────────────────────────────────────────────┐
│          Monitoring EC2 Instance              │
│                                               │
│  ┌─────────────────────────────────────┐     │
│  │         Docker Compose               │     │
│  │                                      │     │
│  │  Grafana (port 3000)                 │     │
│  │    ├── Tempo datasource              │     │
│  │    ├── Loki datasource               │     │
│  │    └── Prometheus datasource          │     │
│  │                                      │     │
│  │  Tempo (4317 gRPC, 4318 HTTP)        │     │
│  │  Loki (3100)                          │     │
│  │  Prometheus (9090)                    │     │
│  │                                      │     │
│  └─────────────────────────────────────┘     │
│                                               │
│  Storage: EBS volume (gp3, 100GB+)            │
└──────────────┬────────────────────────────────┘
               │
               │ Private network (VPC / security group)
               │
┌──────────────┴────────────────────────────────┐
│          App EC2 Instance                     │
│                                               │
│  PM2: stripe-api (cluster mode, 2-4 workers) │
│  PM2: stripe-web (Next.js)                    │
│                                               │
│  Grafana Alloy (systemd):                     │
│    ├── Tails logs/*.log → Loki               │
│    └── Scrapes :3001/metrics → Prometheus     │
│                                               │
│  OTel SDK → OTLP → Tempo (monitoring:4318)   │
│                                               │
│  Sentry → sentry.io (SaaS)                    │
└──────────────────────────────────────────────┘
```

**Pros:**
- Clean separation of concerns — monitoring outage doesn't affect app
- Monitoring instance can be smaller/cheaper (t3.medium vs app's c5.xlarge)
- EBS volume dedicated to metrics/logs/traces — won't fill the app disk
- Scale monitoring independently (vertical for storage, horizontal via Grafana Mimir for multi-tenant)

**Cons:**
- Two EC2 instances to manage (patches, security groups, AMI updates)
- Cross-instance network latency for OTLP export (~1-2ms in same AZ)
- Higher base cost ($30-50/month for the monitoring instance)

### Option B: Sidecar Docker on Same EC2

```
┌──────────────────────────────────────────────┐
│          Single EC2 Instance                  │
│                                               │
│  ┌─────────────────────────────────────┐     │
│  │  PM2: stripe-api (port 3001)         │     │
│  │  PM2: stripe-web (port 3000)         │     │
│  │  Grafana Alloy (systemd)              │     │
│  └─────────────────────────────────────┘     │
│                                               │
│  ┌─────────────────────────────────────┐     │
│  │  Docker Compose (monitoring only)    │     │
│  │  Tempo + Loki + Prometheus + Grafana │     │
│  └─────────────────────────────────────┘     │
│                                               │
└──────────────────────────────────────────────┘
```

**Pros:**
- Single instance — simpler to manage
- No cross-instance latency for telemetry export
- Lower cost (one EC2 instance)

**Cons:**
- **Resource contention** — Tempo/Loki/Prometheus compete with the app for CPU, memory, and disk I/O
- **Disk I/O saturation** — pino-roll writes logs, Loki reads them, Prometheus writes TSDB, Tempo writes blocks — all on the same disk
- **Single point of failure** — if the instance dies, both app AND monitoring are gone
- **Security surface area** — Grafana, Prometheus, Tempo, and Loki all exposed on the same host as the payment app
- **OOM risk** — Prometheus TSDB can consume significant memory; a metrics cardinality explosion could OOM the container and kill the app

### Option C: Grafana Cloud (Managed)

```
┌──────────────────────────────────────────────┐
│          App EC2 Instance                     │
│                                               │
│  PM2: stripe-api                              │
│  PM2: stripe-web                              │
│                                               │
│  Grafana Alloy (systemd):                     │
│    ├── Logs → grafana.com (Loki)              │
│    ├── Metrics → grafana.com (Prometheus)     │
│    └── Traces → grafana.com (Tempo)           │
│                                               │
│  Sentry → sentry.io (SaaS)                    │
└──────────────────────────────────────────────┘
```

**Pros:**
- **Zero infrastructure to manage** — no Docker, no Prometheus config, no disk management
- Free tier: 10k metrics series, 50GB logs, 50GB traces — generous for a single app
- Automatic upgrades, HA, backups
- Single agent (Alloy) ships logs, metrics, AND traces

**Cons:**
- Data egress costs (shipping logs/metrics/traces to cloud)
- Vendor lock-in (though OTLP is an open standard)
- Cost scales with volume — high-traffic payment APIs could get expensive
- Compliance — financial data must not leak into log lines shipped to third-party

### Recommendation

**For production launch: Option A (separate monitoring EC2).** Rationale:
1. A Stripe payments API handles financial data — operational visibility is non-negotiable
2. Keeping monitoring separate prevents a noisy-neighbor problem where a metrics scrape spike degrades payment processing
3. The additional cost ($30-50/month) is trivial compared to the cost of a payment outage
4. If budget is extremely tight, Option C (Grafana Cloud) is a strong second choice — zero ops overhead and the free tier covers most needs

**For the monitoring instance hardware:**
- `t3.medium` (2 vCPU, 4GB RAM) — sufficient for Tempo + Loki + Prometheus + Grafana at moderate volume
- 100GB gp3 EBS (3000 IOPS baseline) — handles ~30 days of traces/logs/metrics
- Place in same VPC + availability zone as the app instance for minimal latency

---

## 9. Additional Architectural Observations

### 9.1 The BullMQ context propagation gap

When a Stripe webhook arrives:
```
HTTP Request (has OTel span context)
  → WebhooksController.processEvent()
  → WebhooksService.processEvent()
  → webhookQueue.add(...)  ← OTel span context LOST here
  → [HTTP returns 200]

Later, in BullMQ worker:
  → WebhookProcessor.process(job)  ← NEW trace context, no parent
  → WebhooksService.execute()
  → dispatch() → handler.handle()
```

The span context from the HTTP request is not propagated into the BullMQ job. This means:
- The trace showing "Stripe webhook received" ends at `queue.add()`
- A separate, orphaned trace starts in the worker
- No end-to-end visibility of webhook processing latency

**Fix:** Use OpenTelemetry's `propagation` API to inject the trace context into the job data, and extract it in the processor:

```typescript
// In WebhooksService.processEvent():
import { propagation, trace } from '@opentelemetry/api';

const carrier = {};
propagation.inject(trace.setSpanContext(trace.getActiveSpan()!.spanContext()), carrier);

await this.webhookQueue.add(WEBHOOK_QUEUE, {
  eventId: event.id,
  recordId,
  traceContext: carrier,  // ← pass through
});

// In WebhookProcessor.process():
const parentContext = propagation.extract(context.active(), job.data.traceContext);
return context.with(parentContext, async () => {
  await this.webhooksService.execute(eventId, recordId);
});
```

### 9.2 The `bufferLogs: false` concern

```typescript
const app = await NestFactory.create(AppModule, {
  bufferLogs: false,  // ← intentional?
});
```

With `bufferLogs: false`, any log message emitted during NestJS bootstrap (module initialization, provider instantiation) goes to the **default NestJS logger** (console.log), NOT to Pino. These early bootstrap logs will:
- Not have trace IDs or correlation IDs
- Not be in JSON format in production
- Not appear in the pino-roll log files
- Not be shipped to Loki (unless stdout is also captured)

This is intentional for development but loses bootstrap diagnostics in production. Recommended: `bufferLogs: true` so bootstrap logs are buffered and flushed to Pino after `app.useLogger()`.

### 9.3 Webhook payload logging risk

The `WebhooksService` encrypts and stores the full Stripe event payload (including potentially sensitive customer data) in Oracle DB. The `processEvent()` method logs:

```typescript
this.logger.log({
  message: 'Webhook event enqueued',
  eventId: event.id,
  eventType: event.type,
  recordId,
});
```

The `StripeExceptionFilter` logs `stripeRequestId` but does not log the raw Stripe event — this is correct and PCI-compliant. However, any `console.log(event)` or `logger.log({ event })` introduced during debugging would leak cardholder data into logs → Loki → potentially unencrypted storage.

### 9.4 Duplicate OTel + Sentry shutdown handlers

```typescript
// instrumentation.ts
process.on('SIGTERM', () => {
  sdk.shutdown().catch(console.error);
});

// main.ts
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

Both register `SIGTERM` handlers. Node.js calls listeners in registration order:
1. `instrumentation.ts`'s SIGTERM → `sdk.shutdown()` (flushes pending spans)
2. `main.ts`'s SIGTERM → `gracefulShutdown()` → `app.close()` → `process.exit(0)`

This ordering is correct — OTel flushes first, then NestJS shuts down. However, `sdk.shutdown()` is async and the handler uses `.catch()` without awaiting. If NestJS shuts down and exits before OTel finishes flushing, pending spans are lost. A more robust approach:

```typescript
let shuttingDown = false;
process.on('SIGTERM', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await sdk.shutdown();
  await gracefulShutdown('SIGTERM');
});
```

---

## 10. Prioritized Action Plan

### Phase 0: Resolve Observability Backend (Week 1)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 0.1 | Resolve SigNoz vs. LGTM vs. Tempo-only ambiguity. Pick ONE. | Architect | 1 day |
| 0.2 | If LGTM: provision monitoring EC2 instance (t3.medium, 100GB gp3) | DevOps | 1 day |
| 0.3 | Deploy Grafana + Tempo + Loki + Prometheus on monitoring instance | DevOps | 2 days |

### Phase 1: Critical Infrastructure (Week 1-2)

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 1.1 | Install Grafana Alloy on app EC2, configure log tailing → Loki | G1 - Critical | 2 hours |
| 1.2 | Configure Prometheus scrape of `:3001/metrics` via Alloy | G2 - Critical | 1 hour |
| 1.3 | Set `OTEL_EXPORTER_OTLP_ENDPOINT` to Tempo in production env | G3 - Critical | 5 minutes |
| 1.4 | Create Grafana dashboard: HTTP latency, error rate, request volume | G4 - Critical | 4 hours |
| 1.5 | Configure basic alerting: error rate > 5%, p95 latency > 2s, webhook DLQ > 0 | G5 - High | 4 hours |
| 1.6 | Secure `/metrics` endpoint — firewall rule or basic auth | G13 - Medium | 30 minutes |

### Phase 2: Application Instrumentation (Week 2-3)

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 2.1 | Add Stripe payment metrics (M1-M3): payment_intents_total, stripe_api_duration, stripe_api_errors | Critical | 1 day |
| 2.2 | Add webhook metrics (M4-M10): event counter, processing duration, queue depth, DLQ size | High | 1 day |
| 2.3 | Add OTel context propagation through BullMQ webhook jobs | G9 - Medium | 4 hours |
| 2.4 | Wrap Stripe SDK calls with custom OTel spans | G10 - Medium | 4 hours |
| 2.5 | Add cache hit/miss metrics to RedisService (M11) | Medium | 1 hour |

### Phase 3: Fixes & Hardening (Week 3-4)

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 3.1 | Resolve Sentry+OTel double-instrumentation: disable Sentry tracesSampleRate OR use @sentry/opentelemetry-node | Medium | 4 hours |
| 3.2 | Fix `@sentry/nestjs` integration — add `Sentry.nestjsIntegration()` to Sentry.init | G12 - Medium | 1 hour |
| 3.3 | Change `bufferLogs: false` → `true` for production bootstrap logging | Low | 5 minutes |
| 3.4 | Replace Stripe health check HTTP call with StripeService.ping check (avoid unnecessary egress) | G14 - Low | 30 minutes |
| 3.5 | Add `LOG_FORMAT` to Joi validation schema | G15 - Low | 5 minutes |
| 3.6 | Synchronize OTel + NestJS SIGTERM handlers to prevent span loss | Low | 30 minutes |
| 3.7 | Create SLO dashboard: 99.9% uptime, p95 < 500ms, error rate < 1% | G6 - High | 4 hours |

### Phase 4: Operational Maturity (Ongoing)

| # | Action | Effort |
|---|--------|--------|
| 4.1 | Define log retention policy: 30 days hot (Loki), 90 days archived (S3) | 2 hours |
| 4.2 | Create runbook for common alerts (webhook DLQ buildup, Stripe API degradation, high latency) | 1 day |
| 4.3 | Load-test observability pipeline — verify Tempo/Loki/Prometheus handle peak throughput | 2 days |
| 4.4 | Add synthetic monitoring — health check ping from external region | 2 hours |
| 4.5 | Evaluate Grafana Cloud migration after 3 months of production data (cost/benefit) | Ongoing |

---

## Appendix A: Key File Index

| File | Purpose |
|------|---------|
| `apps/api/src/instrumentation.ts` | OpenTelemetry SDK initialization |
| `apps/api/src/main.ts` | Bootstrap, Sentry init, graceful shutdown |
| `apps/api/src/app.module.ts` | Module + provider ordering |
| `apps/api/src/logging/logger.module.ts` | Pino configuration (transports, mixin, redaction) |
| `apps/api/src/logging/sanitize.ts` | Sensitive field redaction utilities |
| `apps/api/src/metrics/metrics.service.ts` | Prometheus metric definitions |
| `apps/api/src/metrics/metrics.controller.ts` | GET /metrics endpoint |
| `apps/api/src/common/interceptors/metrics.interceptor.ts` | Per-request metric recording |
| `apps/api/src/common/middleware/correlation-id.middleware.ts` | Correlation ID propagation |
| `apps/api/src/common/filters/all-exceptions.filter.ts` | Global error → structured response |
| `apps/api/src/common/filters/stripe-exception.filter.ts` | Stripe error taxonomy |
| `apps/api/src/health/health.controller.ts` | Health check endpoint |
| `apps/api/src/config/configuration.ts` | Env var → config mapping |
| `apps/api/src/config/validation.schema.ts` | Joi env var validation |
| `apps/api/src/stripe/stripe.service.ts` | Stripe SDK wrapper (not instrumented) |
| `apps/api/src/webhooks/webhooks.service.ts` | Webhook ingestion + BullMQ enqueue |
| `apps/api/src/webhooks/webhook.processor.ts` | BullMQ worker + DLQ handling |
| `docker-compose.yml` | Dev services (Oracle, Redis, Jaeger) |
| `docker-compose.prod.yml` | Prod overrides (removes Jaeger, adds resource limits) |
| `CONTEXT.md` | Domain context (declares SigNoz as backend) |
| `DEPLOYMENT_READINESS.md` | Pre-deployment checklist |

## Appendix B: Dependency Versions (Observability)

| Package | Version | Notes |
|---------|---------|-------|
| `@opentelemetry/sdk-node` | ^0.57.0 | Latest stable |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.57.0 | HTTP/protobuf exporter |
| `@opentelemetry/auto-instrumentations-node` | ^0.53.0 | Slightly behind SDK |
| `@opentelemetry/api` | ^1.9.0 | Stable |
| `@sentry/node` | ^10.53.1 | Very recent |
| `@sentry/nestjs` | ^10.53.1 | NestJS integration |
| `nestjs-pino` | ^4.1.0 | NestJS wrapper for pino |
| `pino` | ^9.5.0 | Core logger |
| `pino-http` | ^10.3.0 | HTTP request logging |
| `pino-roll` | ^4.0.0 | File rotation transport |
| `prom-client` | ^15.1.3 | Prometheus client |
| `@nestjs/terminus` | ^10.2.3 | Health checks |
| `bullmq` | ^5.76.6 | Redis-backed job queue |
| `@nestjs/bullmq` | ^11.0.4 | NestJS BullMQ integration |
