# LGTM Observability Stack — Implementation Plan

> **Project**: Stripe Payments NestJS + Next.js Monorepo  
> **Production**: AWS EC2 + PM2 (no container orchestration)  
> **Date**: 2026-05-19  
> **Status**: Implementation-ready (gap analysis complete)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Gap Analysis — Current State](#2-gap-analysis--current-state)
3. [Gap Analysis — Missing Signals](#3-gap-analysis--missing-signals)
4. [SLO/SLI Definitions](#4-slosli-definitions)
5. [LGTM Stack Architecture](#5-lgtm-stack-architecture)
6. [Docker Compose Files](#6-docker-compose-files)
7. [App-Side Changes](#7-app-side-changes)
8. [PM2 Configuration](#8-pm2-configuration)
9. [Prometheus Alerting Rules](#9-prometheus-alerting-rules)
10. [Grafana Dashboards](#10-grafana-dashboards)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Executive Summary

The application has **partial observability** — logging (Pino), tracing (OpenTelemetry → Jaeger/dev only), basic metrics (prom-client), and error tracking (Sentry). However, **production has zero observability infrastructure**. Traces are discarded in production. Metrics aren't scraped. Logs sit on local disk with no aggregation. There is no alerting.

**What we're building**: A production-grade LGTM stack (Loki + Grafana + Tempo + Mimir/Prometheus) running as Docker Compose on the same EC2 instance, with Alloy/Promtail shipping logs, OTel SDK sending traces+metrics directly, and Grafana pre-configured with dashboards and alerting.

---

## 2. Gap Analysis — Current State

### 2.1 What exists today

| Signal | Implementation | Production Status |
|--------|---------------|-------------------|
| **Logs** | Pino JSON → stdout + `pino-roll` (5×50MB combined, 5×10MB error) | ✅ Working. Files on local disk only. No aggregation. Logs lost on instance termination. |
| **Traces** | `@opentelemetry/sdk-node` + OTLP HTTP exporter → Jaeger in dev | ❌ No production destination. Traces are silently dropped. `OTEL_EXPORTER_OTLP_ENDPOINT` not set in prod. |
| **Metrics** | `prom-client` → `/api/v1/metrics` endpoint (Histogram + Counter) | ⚠️ Exposed with **NO AUTHENTICATION**. No scraper configured. |
| **Errors** | `@sentry/node` (configurable via `SENTRY_DSN`) | ⚠️ Opt-in only. Only active if `SENTRY_DSN` is set. |
| **Health** | `@nestjs/terminus` → `/api/v1/health` (Oracle, Stripe, Redis) | ✅ Working. Used as Docker healthcheck. |
| **Webhook DLQ** | BullMQ dead-letter queue for failed webhook processing | ✅ Exists but **not monitored**. No alert on DLQ growth. |

### 2.2 Critical vulnerabilities

1. **Metrics endpoint exposed without auth** (`apps/api/src/metrics/metrics.controller.ts`):
   - Scrapes Stripe transaction volumes, error rates, and route patterns
   - Anyone can hit `/api/v1/metrics` and enumerate all API routes
   - **Fix**: Add IP allowlist middleware or basic auth to the metrics controller

2. **No production tracing backend**:
   - `docker-compose.prod.yml` explicitly removes Jaeger with `profiles: [observability]`
   - OTel SDK is initialized in `instrumentation.ts` but traces go nowhere
   - `OTEL_EXPORTER_OTLP_ENDPOINT` is only set in dev docker-compose

3. **Logs are ephemeral**:
   - `pino-roll` writes to `logs/combined.log` and `logs/error.log`
   - Files are on the EC2 root volume — gone if instance terminates
   - No log shipping, no retention, no search

4. **No alerting**:
   - Zero alerting rules configured
   - If Redis dies, the app silently fails (throttler goes fail-open, which is good, but nobody knows)
   - If Oracle connection pool saturates, requests pile up
   - If webhook DLQ grows, events accumulate with nobody watching

5. **Redis is single-node with no connection pool metrics**:
   - `RedisService` creates a single `ioredis` client
   - No metrics on connection pool usage, hit rate, or memory consumption

6. **Oracle pool is configured but not monitored**:
   - `poolMax: 20, poolMin: 5` — no visibility into pool utilization
   - No `poolMaxExceeded` events are captured as metrics

---

## 3. Gap Analysis — Missing Signals

### 3.1 RED Metrics (Rate, Errors, Duration) — PER ENDPOINT

**Current state**: The `MetricsInterceptor` records duration and count per route:
```typescript
// apps/api/src/common/interceptors/metrics.interceptor.ts
this.metricsService.recordRequestDuration(method, route, statusCode, durationSeconds);
```
Metrics labels: `{method, route, status_code}`

**Gap**: The `route` label is the raw Express path (e.g., `/api/v1/payment-intents/123`), which creates **unbounded cardinality** when ID params are in the path. The interceptor should normalize routes (e.g., `/api/v1/payment-intents/:id`) before recording.

**Fix needed**: Path normalization in `MetricsInterceptor` (see [App-Side Changes](#7-app-side-changes)).

### 3.2 USE Metrics (Utilization, Saturation, Errors)

| Resource | Current | Gap |
|----------|---------|-----|
| **Oracle connection pool** | poolMax: 20, poolMin: 5 | No visibility into active connections, pending requests, or pool exhaustion |
| **Redis** | Single ioredis client | No connection pool metrics, no hit/miss rate, no memory usage |
| **Node.js event loop** | `collectDefaultMetrics()` in prom-client | Basic CPU/heap only — missing event loop lag histogram, GC pause duration |
| **PM2 process** | None | No process restart count, memory per instance, CPU per instance |

### 3.3 Business Metrics

**Current state**: `ReportingService` has SQL queries for revenue, churn, LTV — but these are **pull-based API endpoints**, not metrics.

**Missing Prometheus business metrics**:

```typescript
// NONE of these exist — all need to be created
stripe_payment_volume_dollars_total        // Counter: total payment volume
stripe_payment_success_rate                // Gauge: success / (success + failure) over window
stripe_payment_decline_total               // Counter: by decline_code
stripe_webhook_events_total                // Counter: by event_type, status
stripe_webhook_processing_duration_seconds // Histogram: webhook processing time
stripe_active_subscriptions_total          // Gauge: active subscriptions by plan
stripe_mrr_dollars                         // Gauge: monthly recurring revenue
stripe_churn_rate                          // Gauge: churn % over period
stripe_dlq_depth                           // Gauge: dead-letter queue size
```

### 3.4 Webhook Observability

**Current state**: Webhooks use BullMQ with 3 retries + DLQ. Webhook processing is async (fire-and-forget from the controller). 

**Missing**:
- Webhook processing latency histogram
- Webhook failure rate by event type
- DLQ depth gauge (critical — if this grows, webhooks are being lost)
- Webhook event age at time of processing (Stripe timestamp vs. processing time)

### 3.5 Stripe API Call Observability

**Current state**: `StripeService` wraps the Stripe SDK. No instrumentation of Stripe API calls.

**Missing**:
- Stripe API call latency by resource (customers, paymentIntents, etc.)
- Stripe API error rate by error type (card_declined, rate_limit, api_error)
- Stripe API rate limit remaining gauge

---

## 4. SLO/SLI Definitions

### 4.1 Availability SLO

| SLI | Target | Window |
|-----|--------|--------|
| **API availability** | 99.9% | 30 days |
| **Health check success rate** | 99.99% | 7 days |
| **Webhook endpoint availability** | 99.95% | 30 days |

**Measurement**: `up` metric from Prometheus blackbox exporter OR health check scrape success rate.

### 4.2 Latency SLO

| SLI | Target | Window |
|-----|--------|--------|
| **P99 latency** (all endpoints) | < 2s | 30 days |
| **P95 latency** (read endpoints) | < 500ms | 30 days |
| **P95 latency** (write/payment endpoints) | < 1s | 30 days |
| **Webhook response time** (200 to Stripe) | < 2s | 30 days |

**Measurement**: `histogram_quantile(0.99, stripe_http_request_duration_seconds)`.

### 4.3 Error Budget

| SLI | Target | Burn Rate Alert |
|-----|--------|-----------------|
| **Error rate** (5xx) | < 1% | Alert at 2% over 1h (fast burn) and 5% over 5min (critical) |
| **Error rate** (4xx on payment endpoints) | < 2% | Alert at 5% over 30min |

### 4.4 Webhook Processing SLO

| SLI | Target | Window |
|-----|--------|--------|
| **Webhook processing success rate** | 99.9% | 30 days |
| **Webhook processing latency** (from receipt to DB commit) | P99 < 30s | 30 days |
| **DLQ depth** | 0 (alert if > 0) | Real-time |

---

## 5. LGTM Stack Architecture

### 5.1 Deployment Strategy

**Recommendation: Run LGTM as Docker Compose on the SAME EC2 instance.**

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Same EC2** | Low latency (localhost), no network egress costs, simpler setup | Resource contention with the app, single point of failure | ✅ **Recommended for initial deployment** |
| **Separate EC2** | Resource isolation, can scale independently | Network latency, egress costs, harder to manage | For scale-up later |
| **Grafana Cloud** | Zero ops, managed retention, built-in alerting | Monthly cost per GB ingested, data egress | For future if team grows |

**Rationale**: For a single EC2 running NestJS + PM2, co-locating the observability stack on the same host keeps latency near-zero and avoids network complexity. The LGTM stack containers have modest resource requirements (see below). If the EC2 instance terminates, you lose recent observability data — but that's acceptable since the primary concern is *operational visibility while the app is running*, not long-term data retention.

### 5.2 Storage Strategy

| Component | Storage Backend | Rationale |
|-----------|----------------|-----------|
| **Loki** | Filesystem on named Docker volume (`loki_data`) + EBS mount | Loki is designed for local filesystem. Use an EBS volume mounted at `/data/loki` to survive container restarts. |
| **Tempo** | Filesystem on named Docker volume (`tempo_data`) + EBS mount | Tempo stores traces locally. For EC2, local disk is fine. For multi-instance, add S3 backend later. |
| **Prometheus** | Named Docker volume (`prometheus_data`) + EBS mount | TSDB requires persistent storage. 15-day retention = ~5-10GB for moderate traffic. |
| **Grafana** | Named Docker volume (`grafana_data`) | Dashboards, datasources, and alerting rules. Small storage (MBs). |

**EBS recommendation**: Create a separate EBS volume (50GB gp3, ~$4/month) mounted at `/data`. Create subdirectories:
```
/data/loki
/data/tempo
/data/prometheus
/data/grafana
```
This decouples observability data from the root volume. If you rebuild the instance, re-attach the EBS volume.

### 5.3 Resource Sizing

Target: **t3.medium** (2 vCPU, 4GB RAM) or **t3.large** (2 vCPU, 8GB RAM)

| Container | CPU Limit | Memory Limit | Notes |
|-----------|-----------|--------------|-------|
| **Grafana** | 0.5 CPU | 256MB | Lightweight. Dashboard rendering is the main cost. |
| **Loki** | 0.5 CPU | 512MB | Ingestion + query. Scales with log volume. |
| **Tempo** | 0.5 CPU | 512MB | Trace ingestion. Distributor + ingester. |
| **Prometheus** | 0.5 CPU | 1GB | Scraping + TSDB compaction. Memory-heavy. |
| **Alloy (log shipper)** | 0.25 CPU | 256MB | Tails log files, minimal resource usage. |
| **Total LGTM** | ~2.25 CPU | ~2.5GB | Leaves ~1.75-5.5GB for the app + Oracle + Redis |

**With a t3.medium (4GB)**:
- App (PM2 cluster): ~1GB (4 workers × 256MB)
- LGTM: ~2.5GB
- OS + Docker: ~500MB
- **Total: ~4GB — tight but workable**

**With a t3.large (8GB)** (recommended):
- App (PM2 cluster): ~1.5GB (4 workers × 384MB)
- LGTM: ~2.5GB
- OS + Docker + headroom: ~4GB
- **Total: ~8GB — comfortable**

### 5.4 Networking

All LGTM containers run on a single Docker network (`observability_net`). Ports exposed to the host:

| Service | Host Port | Internal Port | Exposed to Internet? |
|---------|-----------|---------------|----------------------|
| Grafana | `3000` | `3000` | ⚠️ Via reverse proxy only (NGINX/Caddy with auth) |
| Loki | `3100` | `3100` | ❌ localhost only |
| Tempo OTLP gRPC | `4317` | `4317` | ❌ localhost only |
| Tempo OTLP HTTP | `4318` | `4318` | ❌ localhost only |
| Prometheus | `9090` | `9090` | ❌ localhost only |
| Alloy gRPC | — | `12345` | ❌ internal only |

**Security**: Bind non-Grafana ports to `127.0.0.1` (localhost only). Put Grafana behind NGINX/Caddy with:
- TLS termination (Let's Encrypt)
- Basic auth or OAuth2 proxy (Google SSO)
- IP allowlisting for admin access

---

## 6. Docker Compose Files

### 6.1 `docker-compose.lgtm.yml`

Create at repo root: `/Users/kabo/Desktop/business/stripe-final-final/docker-compose.lgtm.yml`

```yaml
version: '3.9'

# =============================================================================
# LGTM Observability Stack — Production
# Run: docker compose -f docker-compose.lgtm.yml up -d
# =============================================================================
#
# Services:
#   - Loki       — Log aggregation (port 3100)
#   - Tempo      — Trace backend (OTLP gRPC 4317 + HTTP 4318)
#   - Prometheus — Metrics TSDB + scraper (port 9090)
#   - Grafana    — Dashboards + alerting (port 3000)
#   - Alloy      — Log shipper (tails pino log files, ships to Loki)
#
# Volumes persist on /data EBS mount:
#   /data/loki         → loki_data
#   /data/tempo        → tempo_data
#   /data/prometheus   → prometheus_data
#   /data/grafana      → grafana_data
#
# All non-Grafana ports bind to 127.0.0.1 (not exposed to network).
# Grafana should be fronted by NGINX/Caddy with TLS + auth.

services:
  # ===========================================================================
  # Loki — Log Aggregation
  # ===========================================================================
  loki:
    image: grafana/loki:3.3
    container_name: stripe_loki
    restart: unless-stopped
    ports:
      - "127.0.0.1:3100:3100"   # Loki HTTP API (localhost only)
    volumes:
      - loki_data:/loki
      - ./config/loki/loki-config.yaml:/etc/loki/loki-config.yaml:ro
    command: -config.file=/etc/loki/loki-config.yaml
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3100/ready"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - observability_net

  # ===========================================================================
  # Tempo — Distributed Tracing Backend
  # ===========================================================================
  tempo:
    image: grafana/tempo:2.7
    container_name: stripe_tempo
    restart: unless-stopped
    ports:
      - "127.0.0.1:4317:4317"   # OTLP gRPC receiver (localhost only)
      - "127.0.0.1:4318:4318"   # OTLP HTTP receiver (localhost only)
      - "127.0.0.1:3200:3200"   # Tempo query API (localhost only)
    volumes:
      - tempo_data:/var/tempo
      - ./config/tempo/tempo-config.yaml:/etc/tempo/tempo-config.yaml:ro
    command: -config.file=/etc/tempo/tempo-config.yaml
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3200/ready"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - observability_net

  # ===========================================================================
  # Prometheus — Metrics TSDB + Scraper
  # ===========================================================================
  prometheus:
    image: prom/prometheus:v3.1
    container_name: stripe_prometheus
    restart: unless-stopped
    ports:
      - "127.0.0.1:9090:9090"   # Prometheus UI + API (localhost only)
    volumes:
      - prometheus_data:/prometheus
      - ./config/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./config/prometheus/alerting-rules.yml:/etc/prometheus/alerting-rules.yml:ro
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'
      - '--storage.tsdb.retention.size=20GB'
      - '--web.enable-lifecycle'
      - '--web.listen-address=0.0.0.0:9090'
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 1G
        reservations:
          cpus: '0.25'
          memory: 512M
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:9090/-/healthy"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - observability_net

  # ===========================================================================
  # Grafana — Dashboards + Alerting UI
  # ===========================================================================
  grafana:
    image: grafana/grafana:11.5
    container_name: stripe_grafana
    restart: unless-stopped
    ports:
      - "3000:3000"   # Grafana UI (front with reverse proxy + auth!)
    environment:
      GF_SERVER_ROOT_URL: "${GF_SERVER_ROOT_URL:-http://localhost:3000}"
      GF_SECURITY_ADMIN_USER: "${GF_ADMIN_USER:-admin}"
      GF_SECURITY_ADMIN_PASSWORD: "${GF_ADMIN_PASSWORD:-admin}"
      # Disable anonymous access
      GF_AUTH_ANONYMOUS_ENABLED: "false"
      # Disable signup
      GF_AUTH_DISABLE_SIGNUP: "true"
      # SMTP for alerting (configure via env vars in production)
      GF_SMTP_ENABLED: "${GF_SMTP_ENABLED:-false}"
      GF_SMTP_HOST: "${GF_SMTP_HOST:-}"
      GF_SMTP_USER: "${GF_SMTP_USER:-}"
      GF_SMTP_PASSWORD: "${GF_SMTP_PASSWORD:-}"
      GF_SMTP_FROM_ADDRESS: "${GF_SMTP_FROM_ADDRESS:-}"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./config/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources:ro
      - ./config/grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro
      - ./config/grafana/dashboards:/var/lib/grafana/dashboards:ro
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          cpus: '0.25'
          memory: 128M
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    depends_on:
      loki:
        condition: service_healthy
      tempo:
        condition: service_healthy
      prometheus:
        condition: service_healthy
    networks:
      - observability_net

  # ===========================================================================
  # Alloy — Log Shipper (replaces Promtail for flexibility)
  # ===========================================================================
  alloy:
    image: grafana/alloy:v1.6
    container_name: stripe_alloy
    restart: unless-stopped
    volumes:
      # Mount the app's log directory so Alloy can tail the pino-roll files
      - /home/ec2-user/stripe-api/logs:/var/log/app:ro
      - ./config/alloy/config.alloy:/etc/alloy/config.alloy:ro
    command: run --server.http.listen-addr=0.0.0.0:12345 /etc/alloy/config.alloy
    deploy:
      resources:
        limits:
          cpus: '0.25'
          memory: 256M
        reservations:
          cpus: '0.1'
          memory: 128M
    networks:
      - observability_net

volumes:
  loki_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/loki
  tempo_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/tempo
  prometheus_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/prometheus
  grafana_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/grafana

networks:
  observability_net:
    driver: bridge
```

### 6.2 Loki Configuration

Create at: `config/loki/loki-config.yaml`

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096
  log_level: info

common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

ingester:
  chunk_idle_period: 5m
  max_chunk_age: 1h
  chunk_target_size: 1536000
  chunk_retain_period: 30s
  max_transfer_retries: 0
  wal:
    enabled: true
    dir: /loki/wal

schema_config:
  configs:
    - from: "2024-01-01"
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

storage_config:
  tsdb_shipper:
    active_index_directory: /loki/tsdb-index
    cache_location: /loki/tsdb-cache

limits_config:
  allow_structured_metadata: true
  reject_old_samples: true
  reject_old_samples_max_age: 168h        # 7 days
  max_entries_limit_per_query: 5000
  # Retention — keep logs for 30 days
  retention_period: 720h
  retention_stream:
    - selector: '{level="error"}'
      priority: 1
      period: 2160h                      # 90 days for errors

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  retention_delete_delay: 2h
  delete_request_store: filesystem

query_range:
  results_cache:
    cache:
      embedded_cache:
        enabled: true
        max_size_mb: 100

ruler:
  alertmanager_url: http://localhost:9093
```

### 6.3 Tempo Configuration

Create at: `config/tempo/tempo-config.yaml`

```yaml
server:
  http_listen_port: 3200
  log_level: info

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318

ingester:
  max_block_duration: 5m               # Cut blocks when trace is idle for 5m

compactor:
  compaction:
    block_retention: 336h              # 14 days retention for traces

metrics_generator:
  registry:
    external_labels:
      source: tempo
      cluster: stripe-production
  storage:
    path: /var/tempo/generator/wal
    remote_write:
      - url: http://prometheus:9090/api/v1/write
        send_exemplars: true
  traces_storage:
    path: /var/tempo/generator/traces

storage:
  trace:
    backend: local
    wal:
      path: /var/tempo/wal
    local:
      path: /var/tempo/blocks

overrides:
  defaults:
    metrics_generator:
      processors: [service-graphs, span-metrics, local-blocks]
      generate_native_histograms: both
```

### 6.4 Prometheus Configuration

Create at: `config/prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s
  evaluation_interval: 15s
  external_labels:
    cluster: stripe-production
    region: "${AWS_REGION:-us-east-1}"

alerting:
  alertmanagers:
    - static_configs:
        - targets: []
          # Uncomment when Alertmanager is deployed:
          # - targets: ['alertmanager:9093']

rule_files:
  - /etc/prometheus/alerting-rules.yml

scrape_configs:
  # =========================================================================
  # Stripe API — scraped from the NestJS app's /metrics endpoint
  # =========================================================================
  - job_name: stripe-api
    metrics_path: /api/v1/metrics
    scheme: http
    static_configs:
      - targets:
          - 'host.docker.internal:3001'
          # Docker for Mac/Windows uses host.docker.internal
          # On Linux (EC2), use the docker bridge gateway or host IP:
          # - '172.17.0.1:3001'
        labels:
          service: stripe-api
          env: production
    # If /metrics requires auth, use basic_auth:
    # basic_auth:
    #   username: prometheus
    #   password: ${METRICS_SCRAPE_PASSWORD}
    metric_relabel_configs:
      # Drop high-cardinality labels that create too many time series
      - source_labels: [route]
        regex: '.*/health.*'
        action: drop
        # We health-check separately; no need to track health endpoint metrics

  # =========================================================================
  # Stripe API Health Check — blackbox-style health check
  # =========================================================================
  - job_name: stripe-api-health
    metrics_path: /api/v1/health
    scheme: http
    scrape_interval: 30s
    static_configs:
      - targets:
          - 'host.docker.internal:3001'
        labels:
          service: stripe-api-health

  # =========================================================================
  # Prometheus self-scrape
  # =========================================================================
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  # =========================================================================
  # Node Exporter — system metrics (install on EC2 host)
  #   sudo apt-get install prometheus-node-exporter  # Ubuntu/Debian
  #   sudo yum install prometheus-node-exporter       # Amazon Linux
  # =========================================================================
  # - job_name: node
  #   static_configs:
  #     - targets: ['host.docker.internal:9100']
```

### 6.5 Alloy Configuration

Create at: `config/alloy/config.alloy`

```alloy
// ===========================================================================
// Alloy — Log Shipper for Stripe API
// ===========================================================================
// Tails pino JSON log files and ships to Loki.
// Runs as a Docker container with /home/ec2-user/stripe-api/logs mounted at
// /var/log/app.

// Discover and tail all pino log files in the logs directory
loki.source.file "app_logs" {
  targets = [
    // Combined log (all levels)
    {
      __path__  = "/var/log/app/combined.*.log",
      job       = "stripe-api",
      app       = "stripe-api",
      log_type  = "combined",
    },
    // Error log (error level only)
    {
      __path__  = "/var/log/app/error.*.log",
      job       = "stripe-api",
      app       = "stripe-api",
      log_type  = "error",
    },
  ]

  // pino-roll rotates files, so we use glob patterns
  // combined.*.log matches combined.2026-05-19.log, etc.
  
  forward_to = [loki.write.loki.receiver]
}

// ===========================================================================
// Loki Write — ship structured logs to Loki
// ===========================================================================
loki.write "loki" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"

    // Retry on transient failures
    external_labels = {
      host = "stripe-ec2-production",
    }
  }
}

// ===========================================================================
// Live debugging — expose Alloy's own metrics
// ===========================================================================
prometheus.exporter.unix "default" {
  include_exporter_metrics = true
}
```

### 6.6 Grafana Datasource Provisioning

Create at: `config/grafana/provisioning/datasources/datasources.yml`

```yaml
apiVersion: 1

datasources:
  # =========================================================================
  # Prometheus — Metrics
  # =========================================================================
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: 15s
      exemplarTraceIdDestinations:
        - name: trace_id
          datasourceUid: tempo
    version: 1

  # =========================================================================
  # Loki — Logs
  # =========================================================================
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: false
    jsonData:
      maxLines: 1000
      derivedFields:
        - name: trace_id
          matcherRegex: '"traceId":"(\w+)"'
          url: '$${__value.raw}'
          datasourceUid: tempo
    version: 1

  # =========================================================================
  # Tempo — Traces
  # =========================================================================
  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    editable: false
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: '-5m'
        spanEndTimeShift: '5m'
        filterByTraceID: true
        filterBySpanID: false
        customQuery: true
        query: '{job="stripe-api"} |~ "\\"traceId\\":\\"$${__span.traceId}\\""'
      serviceMap:
        datasourceUid: prometheus
      nodeGraph:
        enabled: true
      search:
        hideDeprecated: true
    version: 1
```

Create at: `config/grafana/provisioning/dashboards/dashboards.yml`

```yaml
apiVersion: 1

providers:
  - name: 'Stripe API'
    orgId: 1
    folder: 'Stripe API'
    type: file
    disableDeletion: true
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
```

---

## 7. App-Side Changes

### 7.1 Fix: Path Normalization in Metrics Interceptor

**File**: `apps/api/src/common/interceptors/metrics.interceptor.ts`

The current implementation uses `request.url` directly, which includes route parameters like `/api/v1/payment-intents/550e8400-e29b-41d4-a716-446655440000`. This creates unbounded cardinality.

**Change**: Use `request.route?.path` (set by NestJS after route resolution) or normalize manually:

```typescript
// In MetricsInterceptor.intercept():
// BEFORE (broken — high cardinality):
const route = request.url;

// AFTER (fixed — normalized path):
const route = request.route?.path ?? request.url;
// This produces: '/api/v1/payment-intents/:id' instead of '/api/v1/payment-intents/550e...'
```

**File to modify**: `apps/api/src/common/interceptors/metrics.interceptor.ts`

### 7.2 Fix: Secure the /metrics Endpoint

**File**: `apps/api/src/metrics/metrics.controller.ts`

Add a guard that allows only Prometheus to scrape:

```typescript
// Option A: IP allowlist guard (simplest for EC2)
@Controller('metrics')
@UseGuards(MetricsAccessGuard)  // Only allows 127.0.0.1 / docker bridge
export class MetricsController { ... }

// Option B: Basic auth
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', register.contentType)
  getMetrics(@Headers('authorization') auth: string): Promise<string> {
    // Validate basic auth credentials
  }
}
```

Create `apps/api/src/common/guards/metrics-access.guard.ts`:

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class MetricsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.connection.remoteAddress;
    // Allow localhost and docker bridge network
    const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    // Also allow the Prometheus container's IP on the docker bridge
    // Docker bridge is typically 172.17.0.0/16
    if (allowed.includes(ip)) return true;
    if (ip.startsWith('172.')) return true;  // docker bridge
    return false;
  }
}
```

### 7.3 Change: OTel Exporter for Tempo

**File**: `apps/api/src/instrumentation.ts`

**Current behavior**: 
- Uses `OTLPTraceExporter` (HTTP) with Jaeger-specific `/v1/traces` path
- Only exports traces, not metrics

**Required changes**:

```typescript
// apps/api/src/instrumentation.ts — UPDATED
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { 
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
// EC2 resource detection
import { awsEc2Detector } from '@opentelemetry/resource-detector-aws';
import { detectResources } from '@opentelemetry/resources';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

// Detect cloud resource attributes (EC2 metadata)
const detectedResource = await detectResources({
  detectors: [awsEc2Detector],
});

const sdk = new NodeSDK({
  resource: detectedResource.merge(new Resource({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'stripe-api',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? '1.0.0',
  })),
  
  // Traces → Tempo via OTLP HTTP (port 4318)
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  
  // Metrics → Tempo/Prometheus via OTLP HTTP
  // Tempo's metrics generator can consume OTLP metrics and forward to Prometheus
  metricExporter: new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  }),
  
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // Enable HTTP instrumentation for auto-tracing inbound/outbound HTTP calls
      '@opentelemetry/instrumentation-http': { enabled: true },
      // Enable ioredis instrumentation for Redis call tracing
      '@opentelemetry/instrumentation-ioredis': { enabled: true },
      // Enable pg/oracledb for DB call tracing
      '@opentelemetry/instrumentation-pg': { enabled: false },  // not using pg
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch(console.error);
});
```

**New npm dependency required**: `@opentelemetry/resource-detector-aws`

### 7.4 Add: Business Metrics to MetricsService

**File**: `apps/api/src/metrics/metrics.service.ts`

Add business-level Prometheus metrics:

```typescript
// Add to MetricsService constructor:

// === Business Metrics ===

// Payment volume — increment on payment_intent.succeeded webhook
this.paymentVolumeDollars = new Counter({
  name: 'stripe_payment_volume_dollars_total',
  help: 'Total payment volume in dollars',
  labelNames: ['currency'],
});

// Payment success rate — updated by webhook handlers
this.paymentSuccessTotal = new Counter({
  name: 'stripe_payment_success_total',
  help: 'Total successful payments',
  labelNames: ['currency'],
});

this.paymentFailureTotal = new Counter({
  name: 'stripe_payment_failure_total',
  help: 'Total failed payments by decline code',
  labelNames: ['decline_code', 'currency'],
});

// Active subscriptions gauge
this.activeSubscriptions = new Gauge({
  name: 'stripe_active_subscriptions_total',
  help: 'Total active subscriptions by plan',
  labelNames: ['plan', 'status'],
});

// MRR gauge
this.mrrDollars = new Gauge({
  name: 'stripe_mrr_dollars',
  help: 'Monthly recurring revenue in dollars',
  labelNames: ['currency'],
});

// Webhook processing metrics
this.webhookEventsTotal = new Counter({
  name: 'stripe_webhook_events_total',
  help: 'Total webhook events received',
  labelNames: ['event_type', 'status'],
});

this.webhookProcessingDuration = new Histogram({
  name: 'stripe_webhook_processing_duration_seconds',
  help: 'Webhook processing duration',
  labelNames: ['event_type'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
});

// DLQ depth — updated by webhook processor
this.dlqDepth = new Gauge({
  name: 'stripe_webhook_dlq_depth',
  help: 'Number of jobs in the webhook dead-letter queue',
});

// Stripe API call metrics
this.stripeApiDuration = new Histogram({
  name: 'stripe_api_call_duration_seconds',
  help: 'Stripe API call duration',
  labelNames: ['resource', 'method'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

this.stripeApiErrors = new Counter({
  name: 'stripe_api_errors_total',
  help: 'Stripe API errors by type',
  labelNames: ['resource', 'error_type'],
});

// Oracle connection pool metrics
this.oraclePoolActive = new Gauge({
  name: 'stripe_oracle_pool_active_connections',
  help: 'Active Oracle connections in the pool',
});

this.oraclePoolIdle = new Gauge({
  name: 'stripe_oracle_pool_idle_connections',
  help: 'Idle Oracle connections in the pool',
});

this.oraclePoolPending = new Gauge({
  name: 'stripe_oracle_pool_pending_requests',
  help: 'Pending Oracle connection requests',
});
```

### 7.5 Add: Metrics Publish Points in the Codebase

The business metrics above need to be incremented at the right points:

| Metric | Where to emit | File |
|--------|---------------|------|
| `stripe_payment_volume_dollars_total` | `PaymentIntentHandler.handle()` when `payment_intent.succeeded` | `webhooks/handlers/payment-intent.handler.ts` |
| `stripe_payment_success_total` | Same handler, on success | Same |
| `stripe_payment_failure_total` | Same handler, on `payment_failed` | Same |
| `stripe_webhook_events_total` | `WebhookProcessor.process()` — increment on start and after success/failure | `webhooks/webhook.processor.ts` |
| `stripe_webhook_processing_duration_seconds` | `WebhookProcessor.process()` — observe duration | Same |
| `stripe_webhook_dlq_depth` | `WebhookProcessor.onFailed()` — gauge set to current DLQ count | Same |
| `stripe_active_subscriptions_total` | `SubscriptionHandler` — gauge set on create/cancel/update | `webhooks/handlers/subscription.handler.ts` |
| `stripe_mrr_dollars` | ReportingService or SubscriptionHandler — recalculate periodically | Either |
| `stripe_api_call_duration_seconds` | Wrap StripeService methods — or use OTel auto-instrumentation (already covered) | N/A (OTel handles this) |
| `stripe_oracle_pool_*` | DatabaseModule or a scheduled task that queries TypeORM pool status | `database/database.module.ts` |

### 7.6 Add: EC2 Resource Detection

Install the AWS resource detector:

```bash
cd apps/api && npm install @opentelemetry/resource-detector-aws
```

This adds `cloud.provider: aws`, `host.id`, `cloud.region`, and other EC2 metadata to all spans and metrics. Updated `instrumentation.ts` is shown in section 7.3 above.

### 7.7 Add: Pino → Loki Configuration

**Recommendation**: Use Alloy (or Promtail) to tail the pino-roll log files. Do NOT add a Loki transport to the app.

**Rationale**:
- Pino → Loki transports add runtime overhead and coupling
- File-based shipping (Alloy tails files) is decoupled from the app
- If Alloy goes down, logs are still written to disk (no loss)
- pino-roll already handles rotation; Alloy handles shipping

The Alloy configuration in section 6.5 handles this.

**One change needed in the logger module**: Ensure `traceId` is included in every log line (already done in `PinoLoggerModule` via the `mixin`).

### 7.8 Prometheus Scrape Config — `/metrics` Endpoint

The Prometheus config in section 6.4 already includes the scrape config for `host.docker.internal:3001/api/v1/metrics`.

**Linux EC2 note**: On Linux, `host.docker.internal` is not available by default. Add this to the docker-compose or use the docker bridge gateway IP:

```yaml
# In docker-compose.lgtm.yml, add to prometheus service:
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Or change the Prometheus target to `172.17.0.1:3001` (docker bridge gateway).

---

## 8. PM2 Configuration

### 8.1 `ecosystem.config.js`

Create at: `apps/api/ecosystem.config.js`

```javascript
// =============================================================================
// PM2 Ecosystem Configuration — Production
// =============================================================================
// Deploy:
//   pm2 start ecosystem.config.js --env production
// Reload (zero-downtime):
//   pm2 reload ecosystem.config.js --env production
// Save for resurrection on reboot:
//   pm2 save
//   pm2 startup systemd
// =============================================================================

module.exports = {
  apps: [
    {
      name: 'stripe-api',
      script: './dist/main.js',
      cwd: '/home/ec2-user/stripe-api/apps/api',

      // === Cluster Mode ===
      // 'max' = one worker per CPU core. Balances throughput vs. memory.
      // For a t3.large (2 vCPU): 2 workers. t3.xlarge (4 vCPU): 4 workers.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',

      // === Environment Variables ===
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        API_PREFIX: 'api/v1',
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        API_PREFIX: 'api/v1',
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        LOG_FORMAT: 'json',

        // === OpenTelemetry ===
        OTEL_SERVICE_NAME: 'stripe-api',
        // Tempo OTLP HTTP endpoint — docker-compose LGTM runs on localhost
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        // Sampling: 10% in production to control trace volume
        OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
        OTEL_TRACES_SAMPLER_ARG: '0.1',

        // === Resource Limits (Node.js) ===
        NODE_OPTIONS: '--max-old-space-size=512',
      },

      // === Process Management ===
      max_memory_restart: '512M',     // Restart worker if RSS exceeds 512MB
      kill_timeout: 30000,            // 30s graceful shutdown (matches NestJS app.close())
      listen_timeout: 10000,          // Wait 10s for the app to bind to port
      shutdown_with_message: true,    // Send shutdown message before SIGKILL

      // === Restart Policy ===
      max_restarts: 10,               // Max restarts within restart_delay window
      restart_delay: 5000,            // 5s between restarts
      min_uptime: '10s',              // App must stay up 10s to be considered started
      autorestart: true,

      // === Log Handling ===
      // PM2's built-in logging pipes stdout/stderr to files.
      // We use pino-roll for structured logging, so PM2 logging is a
      // secondary stream for crash/startup logs only.
      error_file: '/home/ec2-user/stripe-api/apps/api/logs/pm2-error.log',
      out_file: '/home/ec2-user/stripe-api/apps/api/logs/pm2-out.log',
      log_file: '/home/ec2-user/stripe-api/apps/api/logs/pm2-combined.log',
      merge_logs: true,               // Merge all cluster workers' logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // === Log Rotation (PM2-managed, separate from pino-roll) ===
      max_size: '10M',
      retain: 5,

      // === Watch & Ignore ===
      watch: false,                   // Disable file watching in production
      ignore_watch: ['node_modules', 'logs', '.git'],

      // === Instance-specific env (each worker gets a unique ID) ===
      instance_var: 'INSTANCE_ID',
    },
  ],
};
```

### 8.2 PM2 Startup on EC2

```bash
# After deploying the app code:
cd /home/ec2-user/stripe-api/apps/api

# Create logs directory
mkdir -p logs

# Start the app
pm2 start ecosystem.config.js --env production

# Save process list for resurrection on reboot
pm2 save

# Generate systemd startup script
pm2 startup systemd
# Follow the instructions printed by the command (usually runs a sudo command)

# Verify
pm2 status
pm2 logs stripe-api --lines 50
```

---

## 9. Prometheus Alerting Rules

Create at: `config/prometheus/alerting-rules.yml`

```yaml
groups:
  # ===========================================================================
  # API Error Rate Alerts
  # ===========================================================================
  - name: stripe_api_errors
    interval: 30s
    rules:
      # High 5xx error rate — critical
      - alert: HighErrorRate5xx
        expr: |
          (
            sum(rate(stripe_http_errors_total{status_code=~"5.."}[5m])) by (service)
            /
            sum(rate(stripe_http_requests_total[5m])) by (service)
          ) > 0.05
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "High 5xx error rate on {{ $labels.service }}"
          description: >
            {{ $labels.service }} has a 5xx error rate of {{ $value | humanizePercentage }}
            over the last 5 minutes. Threshold: 5%.
            Check Sentry for error details and application logs.

      # High 4xx error rate (possible attacker or bug)
      - alert: HighErrorRate4xx
        expr: |
          (
            sum(rate(stripe_http_errors_total{status_code=~"4.."}[30m])) by (service)
            /
            sum(rate(stripe_http_requests_total[30m])) by (service)
          ) > 0.15
        for: 10m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Elevated 4xx error rate on {{ $labels.service }}"
          description: >
            {{ $labels.service }} has a 4xx error rate of {{ $value | humanizePercentage }}
            over the last 30 minutes. May indicate client bugs or abuse.

  # ===========================================================================
  # API Latency Alerts
  # ===========================================================================
  - name: stripe_api_latency
    interval: 30s
    rules:
      # P99 latency breach
      - alert: HighLatencyP99
        expr: |
          histogram_quantile(0.99,
            rate(stripe_http_request_duration_seconds_bucket[5m])
          ) > 2
        for: 10m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "P99 latency > 2s for {{ $labels.route }}"
          description: >
            P99 latency for route {{ $labels.route }} is {{ $value }}s
            over the last 10 minutes. Threshold: 2s.
            Check Oracle query performance and Stripe API latency.

      # P95 latency degradation on payment endpoints
      - alert: PaymentLatencyDegraded
        expr: |
          histogram_quantile(0.95,
            rate(stripe_http_request_duration_seconds_bucket{
              route=~".*payment-intents.*|.*setup-intents.*"
            }[5m])
          ) > 1
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Payment endpoint P95 latency > 1s"
          description: >
            Payment endpoint {{ $labels.route }} has P95 latency of {{ $value }}s.
            This directly impacts user experience during checkout.

  # ===========================================================================
  # Oracle Database Alerts
  # ===========================================================================
  - name: stripe_oracle
    interval: 30s
    rules:
      # Oracle connection pool exhaustion
      - alert: OraclePoolExhausted
        expr: |
          (stripe_oracle_pool_active_connections / 20) > 0.8
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Oracle connection pool > 80% utilized"
          description: >
            Oracle pool has {{ $value | humanizePercentage }} of connections active.
            Pool max is 20. New requests may be queued or rejected.
            Check for slow queries or connection leaks.

      # Oracle connection pool pending requests
      - alert: OraclePoolPending
        expr: stripe_oracle_pool_pending_requests > 5
        for: 2m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "{{ $value }} pending Oracle connection requests"
          description: >
            Requests are waiting for Oracle connections.
            Consider increasing poolMax or investigating query performance.

  # ===========================================================================
  # Redis Alerts
  # ===========================================================================
  - name: stripe_redis
    interval: 30s
    rules:
      # Redis memory usage high
      - alert: RedisMemoryHigh
        expr: |
          redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Redis memory > 80%"
          description: >
            Redis is using {{ $value | humanizePercentage }} of its max memory.
            Consider increasing maxmemory or evicting stale keys.

      # Redis down (no metrics scraped)
      - alert: RedisDown
        expr: absent(redis_up) == 1
        for: 2m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Redis is down or unreachable"
          description: >
            No Redis metrics available. Rate limiting and caching will be degraded.
            The app will fail-open on rate limiting (allows requests through).

  # ===========================================================================
  # Health Check Alerts
  # ===========================================================================
  - name: stripe_health
    interval: 30s
    rules:
      # Health check failing
      - alert: HealthCheckFailed
        expr: |
          up{job="stripe-api-health"} == 0
        for: 5m
        labels:
          severity: critical
          team: backend
          pagerduty: "true"
        annotations:
          summary: "Stripe API health check failing"
          description: >
            The health check endpoint has been failing for 5 minutes.
            Check Oracle, Stripe API, and Redis connectivity.
            Run: pm2 status && docker ps

  # ===========================================================================
  # Webhook Alerts
  # ===========================================================================
  - name: stripe_webhooks
    interval: 30s
    rules:
      # Dead-letter queue not empty
      - alert: WebhookDLQGrown
        expr: stripe_webhook_dlq_depth > 0
        for: 5m
        labels:
          severity: critical
          team: backend
          pagerduty: "true"
        annotations:
          summary: "{{ $value }} webhook events in dead-letter queue"
          description: >
            Webhook events have exhausted all retries and are in the DLQ.
            These events are NOT being processed — customers may have stale data.
            Check webhook logs and manually re-process DLQ entries.

      # Webhook processing lag — events older than 5 minutes still pending
      - alert: WebhookProcessingLag
        expr: |
          rate(stripe_webhook_events_total{status="pending"}[15m]) > 0
        for: 15m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Webhook processing may be lagging"
          description: >
            Webhook events are taking longer than expected to process.
            Check BullMQ queue depth and worker health.

      # High webhook failure rate
      - alert: WebhookFailureRate
        expr: |
          (
            sum(rate(stripe_webhook_events_total{status="failed"}[15m]))
            /
            sum(rate(stripe_webhook_events_total[15m]))
          ) > 0.05
        for: 10m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "> 5% webhook failure rate"
          description: >
            Webhook processing is failing at {{ $value | humanizePercentage }}.
            Check webhook processor logs and Oracle connectivity.

  # ===========================================================================
  # PM2 / Node.js Alerts
  # ===========================================================================
  - name: stripe_nodejs
    interval: 30s
    rules:
      # PM2 restart loop detection
      - alert: PM2RestartLoop
        expr: |
          rate(stripe_process_restarts_total[10m]) > 0.1
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Stripe API may be in a restart loop"
          description: >
            PM2 has restarted the app {{ $value }} times per second over 10 minutes.
            Check pm2 logs and recent deployment for issues.

      # High event loop lag
      - alert: EventLoopLag
        expr: |
          rate(nodejs_eventloop_lag_seconds[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Node.js event loop lag > 50ms"
          description: >
            Event loop is blocked for {{ $value }}s on average.
            Check for CPU-intensive operations or synchronous blocking code.

  # ===========================================================================
  # Stripe Business Metrics Alerts
  # ===========================================================================
  - name: stripe_business
    interval: 60s
    rules:
      # Payment success rate below threshold
      - alert: PaymentSuccessRateDrop
        expr: |
          (
            rate(stripe_payment_success_total[30m])
            /
            (
              rate(stripe_payment_success_total[30m])
              +
              rate(stripe_payment_failure_total[30m])
            )
          ) < 0.85
        for: 15m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Payment success rate dropped below 85%"
          description: >
            Payment success rate is {{ $value | humanizePercentage }}.
            Check decline codes in Stripe dashboard and logs.

      # Spike in specific decline codes
      - alert: PaymentDeclineSpike
        expr: |
          rate(stripe_payment_failure_total{decline_code="card_declined"}[15m]) > 0.1
        for: 10m
        labels:
          severity: info
          team: support
        annotations:
          summary: "Spike in card_declined payments"
          description: >
            Card declines are elevated. May be a bank-side issue or fraud pattern.
            Check Stripe dashboard for decline reason breakdown.
```

---

## 10. Grafana Dashboards

### 10.1 Dashboard Inventory

| Dashboard | Folder | Datasources | Purpose |
|-----------|--------|-------------|---------|
| **RED: API Overview** | Stripe API | Prometheus | Rate, Errors, Duration for every endpoint |
| **Stripe Operations** | Stripe API | Prometheus | Webhook health, queue depth, DLQ, Oracle/Redis |
| **Business Metrics** | Stripe Business | Prometheus | Revenue, MRR, churn, payment success rate, decline codes |
| **Node.js Runtime** | Stripe API | Prometheus | Event loop, GC, heap, process restarts |
| **Traces Explorer** | Stripe API | Tempo | Trace search and service graph |
| **Logs Explorer** | Stripe API | Loki | Log search with trace correlation |

### 10.2 Dashboard JSON Templates

Due to the size of full Grafana dashboard JSON, I provide the key panel specs as a Grafana dashboard provider file. Create a minimal RED dashboard at `config/grafana/dashboards/red-api-overview.json`:

```json
{
  "title": "RED: API Overview",
  "tags": ["stripe", "api", "red"],
  "refresh": "10s",
  "time": { "from": "now-1h", "to": "now" },
  "panels": [
    {
      "title": "Request Rate (per second)",
      "type": "graph",
      "targets": [
        {
          "expr": "sum(rate(stripe_http_requests_total[1m])) by (route)",
          "legendFormat": "{{route}}"
        }
      ]
    },
    {
      "title": "Error Rate (5xx)",
      "type": "graph",
      "targets": [
        {
          "expr": "sum(rate(stripe_http_errors_total{status_code=~\"5..\"}[1m])) by (route) / sum(rate(stripe_http_requests_total[1m])) by (route)",
          "legendFormat": "{{route}}"
        }
      ],
      "thresholds": [
        { "value": 0.01, "color": "green" },
        { "value": 0.05, "color": "red" }
      ]
    },
    {
      "title": "P50/P95/P99 Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.50, sum(rate(stripe_http_request_duration_seconds_bucket[1m])) by (le, route))",
          "legendFormat": "P50 {{route}}"
        },
        {
          "expr": "histogram_quantile(0.95, sum(rate(stripe_http_request_duration_seconds_bucket[1m])) by (le, route))",
          "legendFormat": "P95 {{route}}"
        },
        {
          "expr": "histogram_quantile(0.99, sum(rate(stripe_http_request_duration_seconds_bucket[1m])) by (le, route))",
          "legendFormat": "P99 {{route}}"
        }
      ]
    },
    {
      "title": "Request Duration Heatmap",
      "type": "heatmap",
      "targets": [
        {
          "expr": "sum(rate(stripe_http_request_duration_seconds_bucket[5m])) by (le)",
          "format": "heatmap"
        }
      ]
    }
  ]
}
```

For a production-quality dashboard, create a full JSON export from Grafana after initial setup. The above is a starting template.

---

## 11. Implementation Checklist

### Phase 1: Infrastructure Setup (Week 1)

- [ ] **1.1** Create `/data` directory on EC2 with EBS volume (50GB gp3)
  ```bash
  sudo mkdir -p /data/{loki,tempo,prometheus,grafana}
  sudo chown -R ec2-user:ec2-user /data
  ```

- [ ] **1.2** Create config directories
  ```bash
  mkdir -p config/{loki,tempo,prometheus,grafana/provisioning/{datasources,dashboards},alloy}
  mkdir -p config/grafana/dashboards
  ```

- [ ] **1.3** Write all config files listed in Section 6:
  - `config/loki/loki-config.yaml`
  - `config/tempo/tempo-config.yaml`
  - `config/prometheus/prometheus.yml`
  - `config/prometheus/alerting-rules.yml`
  - `config/alloy/config.alloy`
  - `config/grafana/provisioning/datasources/datasources.yml`
  - `config/grafana/provisioning/dashboards/dashboards.yml`

- [ ] **1.4** Write `docker-compose.lgtm.yml` at repo root

- [ ] **1.5** Start LGTM stack:
  ```bash
  docker compose -f docker-compose.lgtm.yml up -d
  docker compose -f docker-compose.lgtm.yml ps  # verify all healthy
  ```

- [ ] **1.6** Verify:
  - Grafana accessible at `http://<ec2-ip>:3000` (default admin/admin)
  - Loki ready: `curl http://localhost:3100/ready`
  - Tempo ready: `curl http://localhost:3200/ready`
  - Prometheus ready: `curl http://localhost:9090/-/healthy`

### Phase 2: App-Side Changes (Week 1-2)

- [ ] **2.1** Fix path normalization in `MetricsInterceptor`
  - File: `apps/api/src/common/interceptors/metrics.interceptor.ts`
  - Change: `request.url` → `request.route?.path ?? request.url`

- [ ] **2.2** Secure the `/metrics` endpoint
  - Create `apps/api/src/common/guards/metrics-access.guard.ts`
  - Add `@UseGuards(MetricsAccessGuard)` to `MetricsController`
  - Verify: `curl http://<public-ip>:3001/api/v1/metrics` returns 403

- [ ] **2.3** Update `instrumentation.ts` for Tempo + OTLP metrics
  - Add `@opentelemetry/resource-detector-aws` dependency
  - Add `OTLPMetricExporter`
  - Add EC2 resource detection
  - Add ioredis instrumentation

- [ ] **2.4** Add business metrics to `MetricsService`
  - Payment volume, success/failure counters
  - Active subscriptions, MRR gauge
  - Webhook processing metrics
  - DLQ depth gauge
  - Stripe API call metrics
  - Oracle pool metrics

- [ ] **2.5** Add metrics emission points
  - `PaymentIntentHandler`: emit success/failure/volume metrics
  - `WebhookProcessor`: emit processing duration, DLQ depth
  - `SubscriptionHandler`: emit active subscription count
  - `WebhooksService`: emit webhook event counters

- [ ] **2.6** Create `apps/api/ecosystem.config.js` (PM2 config from Section 8)

- [ ] **2.7** Build and deploy app with PM2:
  ```bash
  cd apps/api
  npm run build
  pm2 start ecosystem.config.js --env production
  pm2 save
  pm2 startup systemd
  ```

### Phase 3: Verification (Week 2)

- [ ] **3.1** Verify metrics are being scraped:
  ```bash
  curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
  ```

- [ ] **3.2** Verify logs flowing to Loki:
  - Open Grafana → Explore → Loki datasource → query `{job="stripe-api"}`
  - Verify log lines appear with `traceId` field

- [ ] **3.3** Verify traces flowing to Tempo:
  - Generate some API traffic
  - Open Grafana → Explore → Tempo datasource → Search
  - Verify spans appear

- [ ] **3.4** Verify trace-to-log correlation:
  - In Tempo, click a span → "View logs" → should show correlated log lines

- [ ] **3.5** Verify alerting rules are loaded:
  ```bash
  curl http://localhost:9090/api/v1/rules | jq '.data.groups[] | .name'
  ```

### Phase 4: Dashboards & Alerting (Week 2-3)

- [ ] **4.1** Import or create RED dashboard in Grafana
- [ ] **4.2** Create Stripe Operations dashboard
- [ ] **4.3** Create Business Metrics dashboard
- [ ] **4.4** Configure Grafana alerting (SMTP, Slack/Email notifiers)
- [ ] **4.5** Set up Grafana behind reverse proxy with TLS:
  ```nginx
  # Example NGINX config
  server {
    listen 443 ssl;
    server_name grafana.example.com;
    ssl_certificate /etc/letsencrypt/live/grafana.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/grafana.example.com/privkey.pem;
    location / {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
    }
  }
  ```

### Phase 5: Production Hardening (Week 3+)

- [ ] **5.1** Install Node Exporter on EC2 for system metrics
- [ ] **5.2** Add Node Exporter scrape config to Prometheus
- [ ] **5.3** Set up Alertmanager for multi-channel alerting (Slack, PagerDuty)
- [ ] **5.4** Configure Grafana authentication (Google OAuth or LDAP)
- [ ] **5.5** Set up backup for `/data` EBS volume (AWS Backup or snapshots)
- [ ] **5.6** Document runbooks for each alert (How to respond to "HighErrorRate5xx", etc.)
- [ ] **5.7** Load test and tune resource limits

---

## Appendix A: Key File Inventory

### New Files to Create

| File | Purpose |
|------|---------|
| `docker-compose.lgtm.yml` | LGTM stack Docker Compose |
| `config/loki/loki-config.yaml` | Loki configuration |
| `config/tempo/tempo-config.yaml` | Tempo configuration |
| `config/prometheus/prometheus.yml` | Prometheus scrape config |
| `config/prometheus/alerting-rules.yml` | Alerting rules |
| `config/alloy/config.alloy` | Alloy log shipper config |
| `config/grafana/provisioning/datasources/datasources.yml` | Grafana datasource provisioning |
| `config/grafana/provisioning/dashboards/dashboards.yml` | Grafana dashboard provisioning |
| `config/grafana/dashboards/red-api-overview.json` | RED dashboard |
| `apps/api/ecosystem.config.js` | PM2 production config |
| `apps/api/src/common/guards/metrics-access.guard.ts` | Metrics endpoint auth guard |

### Files to Modify

| File | Changes |
|------|---------|
| `apps/api/src/instrumentation.ts` | Add `OTLPMetricExporter`, EC2 resource detection |
| `apps/api/src/common/interceptors/metrics.interceptor.ts` | Path normalization |
| `apps/api/src/metrics/metrics.controller.ts` | Add `MetricsAccessGuard` |
| `apps/api/src/metrics/metrics.service.ts` | Add business metrics |
| `apps/api/src/webhooks/webhook.processor.ts` | Emit webhook metrics |
| `apps/api/src/webhooks/handlers/payment-intent.handler.ts` | Emit payment metrics |
| `apps/api/src/webhooks/handlers/subscription.handler.ts` | Emit subscription metrics |

### Package.json Changes

```bash
cd apps/api
npm install @opentelemetry/resource-detector-aws @opentelemetry/exporter-metrics-otlp-http
```

---

## Appendix B: Environment Variables Reference

### Required in Production `.env`

```bash
# === App ===
NODE_ENV=production
PORT=3001
API_PREFIX=api/v1

# === Database ===
ORACLE_USER=stripe_app
ORACLE_PASSWORD=<secure-password>
ORACLE_HOST=<oracle-host>
ORACLE_PORT=1521
ORACLE_SERVICE_NAME=XEPDB1

# === Stripe ===
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=2026-03-25.dahlia

# === Redis ===
REDIS_URL=redis://localhost:6379

# === Auth ===
JWT_SECRET=<min-32-char-secret>
CORS_ORIGIN=https://your-frontend.com

# === Observability ===
LOG_LEVEL=info
LOG_FORMAT=json
OTEL_SERVICE_NAME=stripe-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1

# === Sentry (optional but recommended) ===
SENTRY_DSN=https://<key>@sentry.io/<project>

# === Encryption ===
ENCRYPTION_KEY=<32-byte-hex-key>
```

---

## Appendix C: Quick-Start Commands

```bash
# 1. Create EBS-backed data directories
sudo mkdir -p /data/{loki,tempo,prometheus,grafana}
sudo chown -R $(whoami):$(whoami) /data

# 2. Create config directories
mkdir -p config/{loki,tempo,prometheus,grafana/provisioning/{datasources,dashboards},alloy}
mkdir -p config/grafana/dashboards

# 3. Write all config files (use the templates in this plan)

# 4. Start observability stack
docker compose -f docker-compose.lgtm.yml up -d

# 5. Build and deploy the app
cd apps/api
npm ci --omit=dev
npm run build
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd

# 6. Verify
curl http://localhost:3001/api/v1/health
curl http://localhost:3001/api/v1/metrics  # should show Prometheus metrics
curl http://localhost:3100/ready            # Loki
curl http://localhost:3200/ready            # Tempo
curl http://localhost:9090/-/healthy        # Prometheus
curl http://localhost:3000/api/health       # Grafana

# 7. Open Grafana at http://<ec2-ip>:3000 (default admin/admin — CHANGE IMMEDIATELY)
```

---

**End of Implementation Plan**
