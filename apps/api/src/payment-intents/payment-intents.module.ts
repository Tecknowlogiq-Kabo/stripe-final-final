import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';
import { CustomersModule } from '../customers/customers.module';
import { PaymentIntentsService } from './payment-intents.service';
import { PaymentIntentsController } from './payment-intents.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripePaymentIntent]),
    CustomersModule,
  ],
  providers: [PaymentIntentsService],
  controllers: [PaymentIntentsController],
  exports: [PaymentIntentsService],
})
export class PaymentIntentsModule {}
