import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { CustomersModule } from '../customers/customers.module';
import { PaymentIntentsModule } from '../payment-intents/payment-intents.module';
import { SetupIntentsModule } from '../setup-intents/setup-intents.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';
import { TrustModule } from '../trust/trust.module';;
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksRepository } from './webhooks.repository';
import { WebhookProcessor } from './webhook.processor';
import { PaymentIntentHandler } from './handlers/payment-intent.handler';
import { SetupIntentHandler } from './handlers/setup-intent.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoiceHandler } from './handlers/invoice.handler';
import { PaymentMethodHandler } from './handlers/payment-method.handler';
import { CustomerHandler } from './handlers/customer.handler';
import { MandateHandler } from './handlers/mandate.handler';
import { ChargeHandler } from './handlers/charge.handler';
import { RadarHandler } from './handlers/radar.handler';
import { AccountHandler } from './handlers/account.handler';
import { CheckoutSessionHandler } from './handlers/checkout-session.handler';
import { WebhookSignatureGuard } from '../common/guards/webhook-signature.guard';
import { WEBHOOK_QUEUE, WEBHOOK_DLQ } from './webhook-queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('redis.url') },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: WEBHOOK_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    }),
    BullModule.registerQueue({
      name: WEBHOOK_DLQ,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
    CustomersModule,
    PaymentIntentsModule,
    SetupIntentsModule,
    PaymentMethodsModule,
    SubscriptionsModule,
    AuditModule,
    TrustModule,
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhooksRepository,
    WebhookProcessor,
    PaymentIntentHandler,
    SetupIntentHandler,
    SubscriptionHandler,
    InvoiceHandler,
    PaymentMethodHandler,
    CustomerHandler,
    MandateHandler,
    ChargeHandler,
    RadarHandler,
    AccountHandler,
    CheckoutSessionHandler,
    WebhookSignatureGuard,
  ],
})
export class WebhooksModule {}
