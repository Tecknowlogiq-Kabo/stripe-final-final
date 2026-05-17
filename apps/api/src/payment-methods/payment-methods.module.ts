import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsRepository } from './payment-methods.repository';

@Module({
  imports: [CustomersModule],
  providers: [PaymentMethodsService, PaymentMethodsRepository],
  controllers: [PaymentMethodsController],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
