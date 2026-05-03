import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { CustomersModule } from '../customers/customers.module';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripePaymentMethod]),
    CustomersModule,
  ],
  providers: [PaymentMethodsService],
  controllers: [PaymentMethodsController],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
