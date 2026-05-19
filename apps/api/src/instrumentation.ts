/**
 * OpenTelemetry — MUST be first import in main.ts (patches Node internals).
 *
 * Signals shipped to Grafana LGTM stack:
 *   Traces  → OTLP HTTP → Tempo (:4318/v1/traces)
 *   Metrics → OTLP HTTP → Tempo (:4318/v1/metrics) → Prometheus remote_write
 *            + prom-client /metrics endpoint scraped by Prometheus directly
 *   Logs    → Pino JSON → stdout + pino-roll files → Alloy → Loki
 *            traceId/spanId injected via pino mixin() in logger.module.ts
 *
 * Standard OTel env vars (per spec):
 *   OTEL_SERVICE_NAME               → service.name
 *   OTEL_RESOURCE_ATTRIBUTES        → key=val,key=val (e.g. deployment.environment=production)
 *   OTEL_EXPORTER_OTLP_ENDPOINT     → collector URL
 *   OTEL_TRACES_SAMPLER             → always_on | parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG         → sampling ratio (0..1)
 *   OTEL_LOG_LEVEL                  → SDK diagnostics: none | error | warn | info | debug
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// ── Endpoint ────────────────────────────────────────────────────────────────
const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

// ── Sampling ────────────────────────────────────────────────────────────────
// parentbased_traceidratio: respects upstream sampling; roots at configured ratio.
// always_on bypasses all sampling (set OTEL_TRACES_SAMPLER=always_on to debug).
const ratio =
  process.env.OTEL_TRACES_SAMPLER === 'always_on'
    ? 1
    : parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG ?? (process.env.NODE_ENV === 'production' ? '0.1' : '1'));

// ── Resource ────────────────────────────────────────────────────────────────
// autoDetectResources merges OTEL_RESOURCE_ATTRIBUTES + host/OS/process detectors.
// Set OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.instance.id=$(hostname)
const resource = new Resource({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'stripe-api' });

// ── Exporters ───────────────────────────────────────────────────────────────
const traceExporter = new OTLPTraceExporter({ url: `${otlp}/v1/traces` });
const spanProcessor = new BatchSpanProcessor(traceExporter, {
  maxQueueSize: 4096,        // Buffer up to 4096 spans before dropping (default: 2048)
  maxExportBatchSize: 1024,  // Export 1024 spans at a time (default: 512)
  scheduledDelayMillis: 5000, // Flush every 5 seconds
});

// Metrics: OTel SDK metrics (runtime, HTTP, etc.) exported to Tempo every 60s.
// This is IN ADDITION to prom-client /metrics endpoint scraped by Prometheus.
const metricReader = new PeriodicExportingMetricReader({
  exportIntervalMillis: 60_000,   // OTel spec default for OTEL_METRIC_EXPORT_INTERVAL
  exportTimeoutMillis: 30_000,    // OTel spec default for OTEL_METRIC_EXPORT_TIMEOUT
  exporter: new OTLPMetricExporter({ url: `${otlp}/v1/metrics` }),
});

// ── Instrumentations ────────────────────────────────────────────────────────
// Runtime instrumentation: event loop lag, GC pauses, heap stats → OTel metrics.
const instrumentations = getNodeAutoInstrumentations({
  '@opentelemetry/instrumentation-fs': { enabled: false },
  '@opentelemetry/instrumentation-pg': { enabled: false },
});
// Push runtime instrumentation separately (auto-instrumentations returns an array)
instrumentations.push(new RuntimeNodeInstrumentation() as any);

// ── Start SDK ───────────────────────────────────────────────────────────────
const sdk = new NodeSDK({
  resource,
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  spanProcessors: [spanProcessor],
  metricReader,
  instrumentations: [instrumentations],
  autoDetectResources: true,
});

try { sdk.start(); } catch (e) { console.error('OTel SDK start failed', e); }

// ── Shutdown ────────────────────────────────────────────────────────────────
const shutdown = async () => {
  try { await sdk.shutdown(); process.exit(0); } catch { process.exit(1); }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setTimeout(() => { process.exit(1); }, 10_000).unref();
