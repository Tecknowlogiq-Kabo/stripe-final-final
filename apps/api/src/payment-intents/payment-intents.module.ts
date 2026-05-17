import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PaymentIntentsService } from './payment-intents.service';
import { PaymentIntentsController } from './payment-intents.controller';
import { PaymentIntentsRepository } from './payment-intents.repository';

@Module({
  imports: [CustomersModule],
  providers: [PaymentIntentsService, PaymentIntentsRepository],
  controllers: [PaymentIntentsController],
  exports: [PaymentIntentsService],
})
export class PaymentIntentsModule {}
