import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SetupIntentsService } from './setup-intents.service';
import { SetupIntentsRepository } from './setup-intents.repository';

@Module({
  imports: [CustomersModule],
  providers: [SetupIntentsService, SetupIntentsRepository],
  exports: [SetupIntentsService],
})
export class SetupIntentsModule {}
