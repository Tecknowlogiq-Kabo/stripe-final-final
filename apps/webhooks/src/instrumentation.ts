/**
 * OpenTelemetry SDK — MUST be first import in main.ts (patches Node internals).
 *
 * Traces, metrics, and runtime instrumentation for the webhooks microservice.
 * Service name defaults to 'stripe-webhooks' to distinguish from the API app.
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
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'stripe-webhooks',
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
setTimeout(() => { process.exit(1); }, 10_000).unref();
