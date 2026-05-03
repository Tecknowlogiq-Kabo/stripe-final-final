import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';

@Module({
  providers: [ReportingService],
  controllers: [ReportingController],
})
export class ReportingModule {}
