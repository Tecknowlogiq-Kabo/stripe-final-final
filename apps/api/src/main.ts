// MUST be first — patches Node.js internals before any other import
import './instrumentation';

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import * as express from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { SanitizeHtmlPipe } from './common/pipes/sanitize-html.pipe';
import type { INestApplication } from '@nestjs/common';

// Module-level reference so shutdown hooks can access the app instance
let appRef: INestApplication | null = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    // rawBody: true is CRITICAL for Stripe webhook signature verification
    // It makes req.rawBody (Buffer) available before JSON parsing
    rawBody: true,
  });

  // Swap NestJS default logger for pino
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);

  const apiPrefix = configService.get<string>('apiPrefix') ?? 'api/v1';
  const port = configService.get<number>('port') ?? 3001;
  const corsOrigin = configService.get<string>('cors.origin') ?? 'http://localhost:3000';

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI });

  // Limit request body size — prevents DoS via oversized payloads
  // Webhook raw body is captured by NestFactory rawBody:true before this applies
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

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
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'"],
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
    // Sanitize HTML before validation — strips <script>, <img onerror>, etc.
    new SanitizeHtmlPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Strip @Exclude() fields (e.g. passwordHash) from all responses
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Swagger — dev/staging only; never exposed in production
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const config = new DocumentBuilder()
      .setTitle('Stripe Integration API')
      .setDescription('NestJS backend for Stripe payments, subscriptions, and webhooks')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const server = await app.listen(port);
  appRef = app;

  // Keep-alive timeout must exceed the load balancer idle timeout (AWS ALB default: 60s)
  // Setting to 65s prevents premature connection termination under load
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const logger = app.get(Logger);
  logger.log(`Application running on port ${port}`, 'Bootstrap');

  // Graceful shutdown — NestJS closes DB connections, drains pending requests, etc.
  // Use app.close() to drain before exiting, preventing dropped requests.
  const gracefulShutdown = async (signal: string) => {
    logger.log(`${signal} received — shutting down gracefully`, 'Bootstrap');
    appRef = null;
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Unhandled promise rejection — log and drain gracefully instead of instant kill.
  // process.exit(1) in the old handler would kill the process mid-request,
  // potentially corrupting in-flight Stripe operations.
  process.on('unhandledRejection', async (reason) => {
    logger.error({ message: 'Unhandled rejection — shutting down gracefully', reason }, 'Bootstrap');
    try {
      if (appRef) {
        const app = appRef;
        appRef = null;
        await app.close();
      }
    } finally {
      process.exit(1);
    }
  });
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap', err);
  process.exit(1);
});
