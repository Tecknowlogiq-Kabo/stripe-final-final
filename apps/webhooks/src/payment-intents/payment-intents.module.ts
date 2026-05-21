import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PaymentIntentsService } from './payment-intents.service';
import { PaymentIntentsRepository } from './payment-intents.repository';

@Module({
  imports: [CustomersModule],
  providers: [PaymentIntentsService, PaymentIntentsRepository],
  exports: [PaymentIntentsService],
})
export class PaymentIntentsModule {}
