/**
 * OpenTelemetry instrumentation bootstrap.
 * This file MUST be imported as the very first statement in main.ts so that
 * auto-instrumentation patches Node.js core modules before any other import.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'stripe-api',
  traceExporter: new OTLPTraceExporter({
    url:
      (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318') +
      '/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy fs instrumentation
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch(console.error);
});
