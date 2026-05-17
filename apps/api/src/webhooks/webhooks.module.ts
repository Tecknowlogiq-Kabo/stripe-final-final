import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { CustomersModule } from '../customers/customers.module';
import { PaymentIntentsModule } from '../payment-intents/payment-intents.module';
import { SetupIntentsModule } from '../setup-intents/setup-intents.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
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
import { WebhookSignatureGuard } from '../common/guards/webhook-signature.guard';
import { WEBHOOK_QUEUE } from './webhook-queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('redis.url') },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
    CustomersModule,
    PaymentIntentsModule,
    SetupIntentsModule,
    PaymentMethodsModule,
    SubscriptionsModule,
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
    WebhookSignatureGuard,
  ],
})
export class WebhooksModule {}
