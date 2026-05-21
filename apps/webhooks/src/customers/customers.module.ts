import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';

@Module({
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
