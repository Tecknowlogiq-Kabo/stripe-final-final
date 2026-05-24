import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3003),
  API_PREFIX: Joi.string().default('api/v1'),
  ORACLE_USER: Joi.string().required(),
  ORACLE_PASSWORD: Joi.string().required(),
  ORACLE_HOST: Joi.string().required(),
  ORACLE_PORT: Joi.number().default(1521),
  ORACLE_SERVICE_NAME: Joi.string().default('XEPDB1'),
  STRIPE_SECRET_KEY: Joi.string()
    .pattern(/^sk_(test|live)_/)
    .required(),
  STRIPE_WEBHOOK_SECRET: Joi.string()
    .pattern(/^whsec_/)
    .required(),
  STRIPE_API_VERSION: Joi.string().default('2026-03-25.dahlia'),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  CORS_ORIGIN: Joi.string().required(),
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),
  JWT_SECRET: Joi.string().min(32).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).default('redis://localhost:6379'),
  LOG_FORMAT: Joi.string().valid('json', 'pretty').default('json'),
  ENCRYPTION_KEY: Joi.string().min(32).optional(),
  OTEL_SERVICE_NAME: Joi.string().default('stripe-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).default('http://localhost:4318'),
  OTEL_TRACES_SAMPLER: Joi.string().valid('always_on', 'parentbased_traceidratio').optional(),
  OTEL_TRACES_SAMPLER_ARG: Joi.string().optional(),
  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  S3_BUCKET: Joi.string().default('stripe-trust-files'),
  S3_TRUST_PREFIX: Joi.string().default('trust-approved/'),
  TRUST_JWT_SECRET: Joi.string().min(32).optional(),
  TRUST_TOKEN_TTL_SECONDS: Joi.number().default(86400),
  TRUST_GUEST_LINK_BASE_URL: Joi.string().uri({ scheme: ['http', 'https'] }).default('http://localhost:3000'),
  TRUSTID_API_BASE_URL: Joi.string().uri({ scheme: ['http', 'https'] }).default('https://api.trustid.co.uk'),
  TRUSTID_API_KEY: Joi.string().optional(),
  TRUSTID_USERNAME: Joi.string().optional(),
  TRUSTID_PASSWORD: Joi.string().optional(),
  TRUSTID_SESSION_TTL_SECONDS: Joi.number().default(3600),
  TRUSTID_WEBHOOK_CALLBACK_BASE_URL: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
  EMAIL_FROM: Joi.string().optional(),
  EMAIL_AWS_REGION: Joi.string().optional(),
});
