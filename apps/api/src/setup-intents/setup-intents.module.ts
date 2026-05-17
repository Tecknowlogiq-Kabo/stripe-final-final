import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SetupIntentsService } from './setup-intents.service';
import { SetupIntentsController } from './setup-intents.controller';
import { SetupIntentsRepository } from './setup-intents.repository';

@Module({
  imports: [CustomersModule],
  providers: [SetupIntentsService, SetupIntentsRepository],
  controllers: [SetupIntentsController],
  exports: [SetupIntentsService],
})
export class SetupIntentsModule {}
