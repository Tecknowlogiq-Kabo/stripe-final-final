import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { CustomersModule } from '../customers/customers.module';
import { SetupIntentsService } from './setup-intents.service';
import { SetupIntentsController } from './setup-intents.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripeSetupIntent]),
    CustomersModule,
  ],
  providers: [SetupIntentsService],
  controllers: [SetupIntentsController],
  exports: [SetupIntentsService],
})
export class SetupIntentsModule {}
