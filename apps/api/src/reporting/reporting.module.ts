import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ReportingRepository } from './reporting.repository';
import { ReportingController } from './reporting.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  providers: [ReportingService, ReportingRepository],
  controllers: [ReportingController],
})
export class ReportingModule {}
