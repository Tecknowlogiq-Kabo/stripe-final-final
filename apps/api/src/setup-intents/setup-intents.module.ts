import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SetupIntentsService } from './setup-intents.service';
import { SetupIntentsController } from './setup-intents.controller';

@Module({
  imports: [CustomersModule],
  providers: [SetupIntentsService],
  controllers: [SetupIntentsController],
  exports: [SetupIntentsService],
})
export class SetupIntentsModule {}
