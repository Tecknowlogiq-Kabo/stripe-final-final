import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3001),
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
});
