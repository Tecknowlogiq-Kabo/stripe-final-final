import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { PinoLoggerModule } from './logging/logger.module';
import { DatabaseModule } from './database/database.module';
import { StripeModule } from './stripe/stripe.module';
import { CustomersModule } from './customers/customers.module';
import { PaymentIntentsModule } from './payment-intents/payment-intents.module';
import { SetupIntentsModule } from './setup-intents/setup-intents.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ReportingModule } from './reporting/reporting.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { StripeExceptionFilter } from './common/filters/stripe-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { RequestTimeoutMiddleware } from './common/middleware/request-timeout.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    PinoLoggerModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      useFactory: (configService: ConfigService, storage: RedisThrottlerStorage) => ({
        throttlers: [
          {
            name: 'default',
            ttl: (configService.get<number>('throttle.ttl') ?? 60) * 1000,
            limit: configService.get<number>('throttle.limit') ?? 100,
          },
          {
            // Tighter limit for financial write endpoints
            name: 'payment',
            ttl: 60_000,
            limit: 20,
          },
        ],
        storage,
      }),
      inject: [ConfigService, RedisThrottlerStorage],
    }),
    RedisModule,
    DatabaseModule,
    AuthModule,
    StripeModule,
    CustomersModule,
    PaymentIntentsModule,
    SetupIntentsModule,
    PaymentMethodsModule,
    SubscriptionsModule,
    WebhooksModule,
    ReportingModule,
    HealthModule,
  ],
  providers: [
    // Order matters: more specific filters first
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: StripeExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JWT guard runs globally; use @Public() to opt out on specific routes
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    // Timeout on all routes except webhooks — Stripe has its own retry/timeout
    consumer
      .apply(RequestTimeoutMiddleware)
      .exclude({ path: '*/webhooks/*', method: RequestMethod.ALL })
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
