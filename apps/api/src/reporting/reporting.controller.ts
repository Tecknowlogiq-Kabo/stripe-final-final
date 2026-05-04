import { Controller, Get, Param, Query, ParseIntPipe, ParseUUIDPipe } from '@nestjs/common';
import { ReportingService } from './reporting.service';

@Controller('reports')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('revenue/:year')
  getRevenueByMonth(@Param('year', ParseIntPipe) year: number) {
    return this.reportingService.getRevenueByMonth(year);
  }

  @Get('subscriptions/by-plan')
  getSubscribersByPlan() {
    return this.reportingService.getActiveSubscribersByPlan();
  }

  @Get('subscriptions/churn')
  getChurn(@Query('months') months?: string) {
    return this.reportingService.getChurnByMonth(months ? parseInt(months, 10) : 6);
  }

  @Get('customers/:customerId/ltv')
  getCustomerLtv(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.reportingService.getCustomerLtv(customerId);
  }

  @Get('payments/failed-by-decline-code')
  getFailedPayments() {
    return this.reportingService.getFailedPaymentsByDeclineCode();
  }

  @Get('webhooks/health')
  getWebhookHealth() {
    return this.reportingService.getWebhookHealth();
  }

  @Get('customers/cohort-ltv')
  getCohortLtv() {
    return this.reportingService.getCustomerCohortLtv();
  }
}
