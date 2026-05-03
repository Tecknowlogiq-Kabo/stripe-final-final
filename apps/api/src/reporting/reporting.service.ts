import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Revenue breakdown by month and currency for a given year.
   * Uses Oracle-specific: TO_CHAR for date grouping, EXTRACT for year.
   */
  async getRevenueByMonth(year: number): Promise<RevenueByMonthResult[]> {
    return this.dataSource.query<RevenueByMonthResult[]>(
      `SELECT
        TO_CHAR(spi.CREATED_AT, 'YYYY-MM')   AS "month",
        spi.CURRENCY                          AS "currency",
        COUNT(*)                              AS "transactionCount",
        SUM(spi.AMOUNT) / 100                AS "revenueDollars",
        AVG(spi.AMOUNT) / 100                AS "avgTransactionDollars"
      FROM STRIPE_PAYMENT_INTENTS spi
      WHERE spi.STATUS = 'succeeded'
        AND EXTRACT(YEAR FROM spi.CREATED_AT) = :1
      GROUP BY TO_CHAR(spi.CREATED_AT, 'YYYY-MM'), spi.CURRENCY
      ORDER BY "month" ASC, spi.CURRENCY`,
      [year],
    );
  }

  /**
   * Active subscribers per plan with MRR.
   * Uses Oracle JOIN, GROUP BY, CASE for interval normalization.
   */
  async getActiveSubscribersByPlan(): Promise<SubscribersByPlanResult[]> {
    return this.dataSource.query<SubscribersByPlanResult[]>(
      `SELECT
        sp.NAME                                     AS "planName",
        sp.STRIPE_PRICE_ID                          AS "stripePriceId",
        COUNT(ss.ID)                                AS "subscriberCount",
        SUM(
          CASE sp.INTERVAL_TYPE
            WHEN 'year'  THEN sp.AMOUNT / 12
            WHEN 'week'  THEN sp.AMOUNT * 4.33
            ELSE sp.AMOUNT
          END
        ) / 100                                     AS "mrrDollars"
      FROM STRIPE_SUBSCRIPTIONS ss
      JOIN SUBSCRIPTION_PLANS sp ON ss.STRIPE_PRICE_ID = sp.STRIPE_PRICE_ID
      WHERE ss.STATUS = 'active'
      GROUP BY sp.NAME, sp.STRIPE_PRICE_ID, sp.AMOUNT, sp.INTERVAL_TYPE
      ORDER BY "mrrDollars" DESC`,
    );
  }

  /**
   * Canceled subscriptions per month in a date range.
   * Uses Oracle: ADD_MONTHS, TO_CHAR for month grouping.
   */
  async getChurnByMonth(months = 6): Promise<ChurnResult[]> {
    return this.dataSource.query<ChurnResult[]>(
      `SELECT
        TO_CHAR(ss.UPDATED_AT, 'YYYY-MM')     AS "month",
        COUNT(*)                              AS "canceledCount"
      FROM STRIPE_SUBSCRIPTIONS ss
      WHERE ss.STATUS = 'canceled'
        AND ss.UPDATED_AT >= ADD_MONTHS(SYSDATE, :1)
      GROUP BY TO_CHAR(ss.UPDATED_AT, 'YYYY-MM')
      ORDER BY "month" ASC`,
      [-Math.abs(months)],
    );
  }

  /**
   * Customer lifetime value with payment history.
   * Uses Oracle: NVL for null safety, LEFT JOIN for customers with no payments.
   */
  async getCustomerLtv(customerId: string): Promise<LtvResult[]> {
    return this.dataSource.query<LtvResult[]>(
      `SELECT
        sc.EMAIL                                    AS "email",
        NVL(SUM(spi.AMOUNT), 0)                    AS "ltvCents",
        COUNT(spi.ID)                              AS "totalTransactions",
        MIN(spi.CREATED_AT)                        AS "firstPayment",
        MAX(spi.CREATED_AT)                        AS "lastPayment"
      FROM STRIPE_CUSTOMERS sc
      LEFT JOIN STRIPE_PAYMENT_INTENTS spi
        ON spi.CUSTOMER_ID = sc.ID
        AND spi.STATUS = 'succeeded'
      WHERE sc.ID = :1
        AND sc.IS_DELETED = 0
      GROUP BY sc.EMAIL`,
      [customerId],
    );
  }

  /**
   * Failed payments analysis by decline code in current month.
   * Uses Oracle: TRUNC for month start, analytic function for percentage.
   */
  async getFailedPaymentsByDeclineCode(): Promise<
    Array<{ declineCode: string; failureCount: string; failurePct: string }>
  > {
    return this.dataSource.query(
      `SELECT
        NVL(spi.ERROR_DECLINE_CODE, 'unknown')     AS "declineCode",
        COUNT(*)                                   AS "failureCount",
        ROUND(
          COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (),
          2
        )                                          AS "failurePct"
      FROM STRIPE_PAYMENT_INTENTS spi
      WHERE spi.STATUS = 'requires_payment_method'
        AND spi.CREATED_AT >= TRUNC(SYSDATE, 'MM')
      GROUP BY spi.ERROR_DECLINE_CODE
      ORDER BY "failureCount" DESC
      FETCH FIRST 10 ROWS ONLY`,
    );
  }

  /**
   * Webhook processing health for the last 24 hours.
   * Uses Oracle: SYSDATE arithmetic, interval math for timing.
   */
  async getWebhookHealth(): Promise<WebhookHealthResult[]> {
    return this.dataSource.query<WebhookHealthResult[]>(
      `SELECT
        we.EVENT_TYPE                              AS "eventType",
        we.STATUS                                 AS "status",
        COUNT(*)                                  AS "eventCount",
        NVL(
          AVG(
            CASE WHEN we.PROCESSED_AT IS NOT NULL THEN
              EXTRACT(SECOND FROM (we.PROCESSED_AT - we.CREATED_AT)) +
              EXTRACT(MINUTE FROM (we.PROCESSED_AT - we.CREATED_AT)) * 60 +
              EXTRACT(HOUR FROM (we.PROCESSED_AT - we.CREATED_AT)) * 3600
            END
          ), 0
        )                                         AS "avgProcessingSeconds"
      FROM STRIPE_WEBHOOK_EVENTS we
      WHERE we.CREATED_AT >= SYSDATE - 1
      GROUP BY we.EVENT_TYPE, we.STATUS
      ORDER BY we.EVENT_TYPE, we.STATUS`,
    );
  }

  /**
   * Customer cohort LTV analysis — grouped by signup month.
   * Uses Oracle: WITH clause (CTE), LEFT JOIN, NULLIF for safe division.
   */
  async getCustomerCohortLtv(): Promise<
    Array<{
      cohortMonth: string;
      customers: string;
      totalRevenueDollars: string;
      avgLtvDollars: string;
    }>
  > {
    return this.dataSource.query(
      `SELECT
        TO_CHAR(sc.CREATED_AT, 'YYYY-MM')          AS "cohortMonth",
        COUNT(DISTINCT sc.ID)                      AS "customers",
        NVL(SUM(spi.AMOUNT), 0) / 100             AS "totalRevenueDollars",
        NVL(SUM(spi.AMOUNT), 0) / 100 /
          NULLIF(COUNT(DISTINCT sc.ID), 0)         AS "avgLtvDollars"
      FROM STRIPE_CUSTOMERS sc
      LEFT JOIN STRIPE_PAYMENT_INTENTS spi
        ON spi.CUSTOMER_ID = sc.ID
        AND spi.STATUS = 'succeeded'
      WHERE sc.IS_DELETED = 0
      GROUP BY TO_CHAR(sc.CREATED_AT, 'YYYY-MM')
      ORDER BY "cohortMonth" ASC`,
    );
  }
}
