import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration, { validationSchema } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { StripeModule } from './stripe/stripe.module';
import { EmailModule } from './email/email.module';
import { CryptoModule } from './crypto/crypto.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TrustIdWebhookModule } from './webhooks/trustid-webhook.module';

/**
 * Webhooks-only NestJS application.
 *
 * This microservice is dedicated to receiving and processing
 * Stripe and TrustID webhook callbacks. It has:
 *   - NO user-facing API endpoints
 *   - NO auth (both webhook endpoints are @Public()-equivalent)
 *   - NO throttler (webhooks must never be rate-limited)
 *   - NO health/metrics/reporting modules
 *
 * All domain services are self-contained within this app.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    DatabaseModule,
    RedisModule,
    StripeModule,
    EmailModule,
    CryptoModule,
    WebhooksModule,
    TrustIdWebhookModule,
  ],
})
export class AppModule {}
