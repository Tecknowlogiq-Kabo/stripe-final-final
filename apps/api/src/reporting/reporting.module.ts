import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ReportingRepository } from './reporting.repository';
import { ReportingController } from './reporting.controller';

@Module({
  providers: [ReportingService, ReportingRepository],
  controllers: [ReportingController],
})
export class ReportingModule {}
