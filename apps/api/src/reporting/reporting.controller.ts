import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReportingService } from './reporting.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../entities/user.entity';
import { CustomersService } from '../customers/customers.service';

@Controller('reports')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class ReportingController {
  constructor(
    private readonly reportingService: ReportingService,
    private readonly customersService: CustomersService,
  ) {}

  /** Aggregate revenue — admin only. */
  @Get('revenue/:year')
  @Roles(UserRole.ADMIN)
  getRevenueByMonth(@Param('year', ParseIntPipe) year: number) {
    return this.reportingService.getRevenueByMonth(year);
  }

  /** MRR by plan — admin only. */
  @Get('subscriptions/by-plan')
  @Roles(UserRole.ADMIN)
  getSubscribersByPlan() {
    return this.reportingService.getActiveSubscribersByPlan();
  }

  /** Churn rate — admin only. */
  @Get('subscriptions/churn')
  @Roles(UserRole.ADMIN)
  getChurn(@Query('months') months?: string) {
    return this.reportingService.getChurnByMonth(months ? parseInt(months, 10) : 6);
  }

  /** Single customer LTV — must own the customer OR be admin. */
  @Get('customers/:customerId/ltv')
  async getCustomerLtv(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (user.role !== UserRole.ADMIN) {
      const customer = await this.customersService.findById(customerId);
      if (!customer) {
        throw new ForbiddenException('Access denied');
      }
      if (customer.userId !== user.id) {
        throw new ForbiddenException('Access denied');
      }
    }
    return this.reportingService.getCustomerLtv(customerId);
  }

  /** Payment failure patterns — admin only. */
  @Get('payments/failed-by-decline-code')
  @Roles(UserRole.ADMIN)
  getFailedPayments() {
    return this.reportingService.getFailedPaymentsByDeclineCode();
  }

  /** Public so monitoring tools can poll without auth. */
  @Public()
  @Get('webhooks/health')
  getWebhookHealth() {
    return this.reportingService.getWebhookHealth();
  }

  /** Cohort LTV — admin only. */
  @Get('customers/cohort-ltv')
  @Roles(UserRole.ADMIN)
  getCohortLtv() {
    return this.reportingService.getCustomerCohortLtv();
  }
}
