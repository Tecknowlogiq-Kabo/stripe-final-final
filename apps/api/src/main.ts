import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // rawBody: true is CRITICAL for Stripe webhook signature verification
    // It makes req.rawBody (Buffer) available before JSON parsing
    rawBody: true,
  });

  // Swap NestJS logger for Winston
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('apiPrefix') ?? 'api/v1';
  const port = configService.get<number>('port') ?? 3001;
  const corsOrigin = configService.get<string>('cors.origin') ?? 'http://localhost:3000';

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI });

  // Helmet with production-grade CSP scoped to Stripe's required origins
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Stripe.js iframe + redirect frames
          frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
          // Only load scripts from our origin and Stripe
          scriptSrc: ["'self'", 'https://js.stripe.com'],
          // API calls to our backend and Stripe
          connectSrc: ["'self'", 'https://api.stripe.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
      hsts: {
        maxAge: 31_536_000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.use(compression());

  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Correlation-Id',
      'Stripe-Signature',
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const server = await app.listen(port);

  // Keep-alive timeout must exceed the load balancer idle timeout (AWS ALB default: 60s)
  // Setting to 65s prevents premature connection termination under load
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  logger.log(`Application running on port ${port}`, 'Bootstrap');

  // Graceful shutdown — NestJS closes DB connections, pending requests, etc.
  const gracefulShutdown = async (signal: string) => {
    logger.log(`${signal} received — shutting down gracefully`, 'Bootstrap');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});
