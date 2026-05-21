import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';

@Module({
  imports: [CustomersModule],
  providers: [SubscriptionsService, SubscriptionsRepository],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
