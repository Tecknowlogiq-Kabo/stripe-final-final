import { validationSchema } from '@stripe-integration/domain';

export { validationSchema };

/**
 * Webhooks app configuration.
 * Extends the shared domain configuration with webhook-specific defaults.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3002', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  database: {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    host: process.env.ORACLE_HOST,
    port: parseInt(process.env.ORACLE_PORT ?? '1521', 10),
    serviceName: process.env.ORACLE_SERVICE_NAME ?? 'XEPDB1',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    apiVersion: process.env.STRIPE_API_VERSION ?? '2026-03-25.dahlia',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  observability: {
    otelServiceName: process.env.OTEL_SERVICE_NAME ?? 'stripe-webhooks',
    otelExporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    otelTracesSampler: process.env.OTEL_TRACES_SAMPLER,
    otelTracesSamplerArg: process.env.OTEL_TRACES_SAMPLER_ARG,
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
  trustid: {
    webhookSecret: process.env.TRUSTID_WEBHOOK_SECRET,
  },
});
