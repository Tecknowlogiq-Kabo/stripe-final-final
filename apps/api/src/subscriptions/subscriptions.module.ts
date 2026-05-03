import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripeSubscription, SubscriptionPlan]),
    CustomersModule,
  ],
  providers: [SubscriptionsService],
  controllers: [SubscriptionsController],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
