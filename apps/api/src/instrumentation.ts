/**
 * OpenTelemetry SDK — MUST be first import in main.ts (patches Node internals).
 *
 * ── SIGNAL PIPELINE (all signals → Grafana LGTM) ─────────────────────────
 *
 *   Traces:
 *     NodeSDK → BatchSpanProcessor → OTLPTraceExporter → Tempo :4318/v1/traces
 *
 *   Metrics (two paths, complementary):
 *     A. prom-client → /api/v1/metrics → Prometheus scrape (every 15s)
 *     B. NodeSDK → PeriodicExportingMetricReader → OTLP → Tempo :4318/v1/metrics
 *        → Prometheus remote_write
 *     Path A covers custom HTTP/business metrics. Path B covers runtime metrics
 *     (event loop, GC, heap) and auto-instrumented HTTP/server metrics.
 *
 *   Logs:
 *     Pino (nestjs-pino) → stdout + pino-roll files → Alloy tails → Loki :3100
 *     traceId + spanId injected per-log-line via nestjs-pino mixin()
 *     → logger.module.ts calls trace.getActiveSpan() to extract context.
 *
 * ── AUTO-INSTRUMENTED (getNodeAutoInstrumentations) ───────────────────────
 *   http, express, nestjs-core, ioredis, dns, net, grpc
 *   fs + pg disabled (fs = noisy, pg = we use Oracle).
 *
 * ── MANUAL SPANS (custom instrumentation) ────────────────────────────────
 *   webhooks.service.ts   → webhooks.processEvent / webhooks.execute
 *   webhook.processor.ts  → webhook.process (BullMQ job lifecycle)
 *   stripe.service.ts     → (outbound HTTP auto-traced by http instrumentation)
 *
 * ── STANDARD ENV VARS (per OTel spec) ─────────────────────────────────────
 *   OTEL_SERVICE_NAME               → service.name (default: stripe-api)
 *   OTEL_RESOURCE_ATTRIBUTES        → key=val pairs merged into resource
 *   OTEL_EXPORTER_OTLP_ENDPOINT     → collector (default: http://localhost:4318)
 *   OTEL_TRACES_SAMPLER             → always_on | parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG         → ratio 0..1 (prod: 0.1, dev: 1)
 *   OTEL_LOG_LEVEL                  → SDK diagnostics: info | debug | error | none
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const ratio = parseFloat(
  process.env.OTEL_TRACES_SAMPLER === 'always_on'
    ? '1'
    : process.env.OTEL_TRACES_SAMPLER_ARG ?? (process.env.NODE_ENV === 'production' ? '0.1' : '1'),
);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'stripe-api',
  }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${otlp}/v1/traces` }))],
  metricReader: new PeriodicExportingMetricReader({
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 30_000,
    exporter: new OTLPMetricExporter({ url: `${otlp}/v1/metrics` }),
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-pg': { enabled: false },
    }),
    new RuntimeNodeInstrumentation(),
  ] as any,
  autoDetectResources: true,
});

try { sdk.start(); } catch (e) { console.error('OTel SDK start failed — continuing without telemetry', e); }

const shutdown = async () => { try { await sdk.shutdown(); process.exit(0); } catch { process.exit(1); } };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
