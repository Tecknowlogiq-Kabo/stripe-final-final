import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingRecord } from '../entities/billing-record.entity';
import { Notification } from '../entities/notification.entity';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripeModule } from '../stripe/stripe.module';
import { BillingService } from './billing.service';
import { BillingRecordRepository } from './billing-record.repository';
import { NotificationRepository } from './notification.repository';
import { BillingController } from './billing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingRecord, Notification, StripeSubscription, StripeCustomer]),
    StripeModule,
  ],
  providers: [BillingService, BillingRecordRepository, NotificationRepository],
  controllers: [BillingController],
  exports: [BillingService, NotificationRepository],
})
export class BillingModule {}
