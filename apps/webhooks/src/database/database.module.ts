import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { StripeWebhookEvent } from '../entities/stripe-webhook-event.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'oracle',
        username: config.get<string>('database.user'),
        password: config.get<string>('database.password'),
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        serviceName: config.get<string>('database.serviceName'),
        entities: [
          StripeCustomer,
          StripePaymentMethod,
          StripePaymentIntent,
          StripeSetupIntent,
          StripeSubscription,
          StripeWebhookEvent,
          SubscriptionPlan,
          User,
        ],
        synchronize: false, // NEVER true in production — use migrations only
        migrationsRun: false, // run manually via CLI or on startup in dev
        logging: config.get<string>('NODE_ENV') === 'development',
        logger: 'advanced-console',
        extra: {
          poolMax: 20,
          poolMin: 5,
          poolTimeout: 30,
          poolPingEnabled: true,
          poolPingInterval: 60,
        },
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
