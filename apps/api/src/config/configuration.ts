export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
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
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    format: process.env.LOG_FORMAT ?? 'json',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    // Previous secret — allows rotation without invalidating all active tokens.
    // Set JWT_PREVIOUS_SECRET during rotation, remove 15 min later when all
    // tokens signed with the old secret have expired.
    previousSecret: process.env.JWT_PREVIOUS_SECRET,
    expiresIn: '15m',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  observability: {
    otelServiceName: process.env.OTEL_SERVICE_NAME ?? 'stripe-api',
    otelExporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    otelTracesSampler: process.env.OTEL_TRACES_SAMPLER,
    otelTracesSamplerArg: process.env.OTEL_TRACES_SAMPLER_ARG,
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
  aws: {
    region: process.env.AWS_REGION ?? 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET ?? 'stripe-trust-files',
    s3TrustPrefix: process.env.S3_TRUST_PREFIX ?? 'trust-approved/',
  },
  trust: {
    jwtSecret: process.env.TRUST_JWT_SECRET ?? process.env.JWT_SECRET,
    tokenTtlSeconds: parseInt(process.env.TRUST_TOKEN_TTL_SECONDS ?? '86400', 10),
    guestLinkBaseUrl: process.env.TRUST_GUEST_LINK_BASE_URL ?? 'http://localhost:3000',
  },
});
