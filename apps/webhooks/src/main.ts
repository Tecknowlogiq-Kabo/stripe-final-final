// MUST be first — patches Node.js internals before any other import
import './instrumentation';

import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import * as express from 'express';
import { AppModule } from './app.module';
import type { INestApplication } from '@nestjs/common';

let appRef: INestApplication | null = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    // rawBody: true is CRITICAL for Stripe webhook signature verification
    rawBody: true,
  });

  const configService = app.get(ConfigService);

  const apiPrefix = configService.get<string>('apiPrefix') ?? 'api/v1';
  const port = configService.get<number>('port') ?? 3002;

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI });

  // Limit request body size
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Helmet with CSP scoped to Stripe origins
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
          scriptSrc: ["'self'", 'https://js.stripe.com'],
          connectSrc: ["'self'", 'https://api.stripe.com'],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.use(compression());

  // Webhooks-only: allow any origin (webhooks come from Stripe/TrustID, not browsers)
  app.enableCors({
    origin: '*',
    methods: ['POST', 'OPTIONS'],
  });

  // NO global auth guards — webhook endpoints are unauthenticated
  // NO throttler — webhooks must never be rate-limited
  // NO health/reporting modules

  const server = await app.listen(port);
  appRef = app;

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  console.log(`Webhooks app running on port ${port}`, 'Bootstrap');

  const gracefulShutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down gracefully`, 'Bootstrap');
    appRef = null;
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', async (reason) => {
    console.error({ message: 'Unhandled rejection — shutting down gracefully', reason }, 'Bootstrap');
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
