import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { LoggingModule } from './logging/winston.config';
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
import { StripeExceptionFilter } from './common/filters/stripe-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggingModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          ttl: (configService.get<number>('throttle.ttl') ?? 60) * 1000,
          limit: configService.get<number>('throttle.limit') ?? 100,
        },
      ],
      inject: [ConfigService],
    }),
    DatabaseModule,
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
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
