import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingRecordRepository } from './billing-record.repository';
import { DevOnlyGuard } from './dev-only.guard';
import { BillingRecord } from '../entities/billing-record.entity';

class CreateBillingRecordDto {
  subscriptionId: string;
  chargeAmount: number;
  currency?: string;
}

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly billingRecordRepo: BillingRecordRepository,
  ) {}

  @Post('dev/records')
  @UseGuards(DevOnlyGuard)
  async createRecord(@Body() body: CreateBillingRecordDto): Promise<BillingRecord> {
    return this.billingService.createBillingRecord(
      body.subscriptionId,
      body.chargeAmount,
      body.currency,
    );
  }

  @Post('dev/trigger/:subscriptionId')
  @UseGuards(DevOnlyGuard)
  async triggerCharge(
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<{ status: string; stripePaymentIntentId?: string; error?: string }> {
    return this.billingService.triggerChargeForSubscription(subscriptionId);
  }

  @Get('records/:subscriptionId')
  async getRecords(
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<BillingRecord[]> {
    return this.billingRecordRepo.findBySubscriptionId(subscriptionId);
  }
}
