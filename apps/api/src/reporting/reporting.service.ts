import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ReportingRepository } from './reporting.repository';

// Reports are analytics — 5-minute cache is fine
const REPORT_TTL = 300;

export interface RevenueByMonthResult {
  month: string;
  currency: string;
  transactionCount: string;
  revenueDollars: string;
  avgTransactionDollars: string;
}

export interface SubscribersByPlanResult {
  planName: string;
  stripePriceId: string;
  subscriberCount: string;
  mrrDollars: string;
}

export interface ChurnResult {
  month: string;
  canceledCount: string;
}

export interface LtvResult {
  email: string;
  ltvCents: string;
  totalTransactions: string;
  firstPayment: Date | null;
  lastPayment: Date | null;
}

export interface WebhookHealthResult {
  eventType: string;
  status: string;
  eventCount: string;
  avgProcessingSeconds: string;
}

@Injectable()
export class ReportingService {
  constructor(
    private readonly repo: ReportingRepository,
    private readonly redis: RedisService,
  ) {}

  async getRevenueByMonth(year: number): Promise<RevenueByMonthResult[]> {
    const cacheKey = `report:revenue:${year}`;
    const cached = await this.redis.get<RevenueByMonthResult[]>(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getRevenueByMonth(year);
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }

  async getActiveSubscribersByPlan(): Promise<SubscribersByPlanResult[]> {
    const cacheKey = 'report:subscribers-by-plan';
    const cached = await this.redis.get<SubscribersByPlanResult[]>(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getActiveSubscribersByPlan();
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }

  async getChurnByMonth(months = 6): Promise<ChurnResult[]> {
    const cacheKey = `report:churn:${months}`;
    const cached = await this.redis.get<ChurnResult[]>(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getChurnByMonth(months);
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }

  async getCustomerLtv(customerId: string): Promise<LtvResult[]> {
    const cacheKey = `report:ltv:${customerId}`;
    const cached = await this.redis.get<LtvResult[]>(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getCustomerLtv(customerId);
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }

  async getFailedPaymentsByDeclineCode(): Promise<
    Array<{ declineCode: string; failureCount: string; failurePct: string }>
  > {
    const cacheKey = 'report:failed-payments-decline';
    const cached = await this.redis.get<
      Array<{ declineCode: string; failureCount: string; failurePct: string }>
    >(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getFailedPaymentsByDeclineCode();
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }

  async getWebhookHealth(): Promise<WebhookHealthResult[]> {
    const cacheKey = 'report:webhook-health';
    const cached = await this.redis.get<WebhookHealthResult[]>(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getWebhookHealth();
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }

  async getCustomerCohortLtv(): Promise<
    Array<{
      cohortMonth: string;
      customers: string;
      totalRevenueDollars: string;
      avgLtvDollars: string;
    }>
  > {
    const cacheKey = 'report:cohort-ltv';
    const cached = await this.redis.get<
      Array<{
        cohortMonth: string;
        customers: string;
        totalRevenueDollars: string;
        avgLtvDollars: string;
      }>
    >(cacheKey);
    if (cached) return cached;

    const result = await this.repo.getCustomerCohortLtv();
    await this.redis.set(cacheKey, result, REPORT_TTL);
    return result;
  }
}
