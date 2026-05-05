import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PaymentIntentsService } from './payment-intents.service';
import { PaymentIntentsController } from './payment-intents.controller';

@Module({
  imports: [CustomersModule],
  providers: [PaymentIntentsService],
  controllers: [PaymentIntentsController],
  exports: [PaymentIntentsService],
})
export class PaymentIntentsModule {}
