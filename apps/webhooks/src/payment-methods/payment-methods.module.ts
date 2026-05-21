import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsRepository } from './payment-methods.repository';

@Module({
  imports: [CustomersModule],
  providers: [PaymentMethodsService, PaymentMethodsRepository],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
