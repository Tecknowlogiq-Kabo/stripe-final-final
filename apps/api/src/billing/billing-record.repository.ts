import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BillingRecord } from '../entities/billing-record.entity';
import { BILLING_RECORD_SELECT } from '../database/query-constants';

export interface BillingRecordWithRelations {
  billingRecord: BillingRecord;
  subscription: {
    id: string;
    customerId: string;
    defaultPaymentMethodId: string | null;
  };
  customer: {
    stripeCustomerId: string;
  };
}

@Injectable()
export class BillingRecordRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async insert(
    id: string,
    subscriptionId: string,
    chargeAmount: number,
    currency: string,
    periodDate: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO BILLING_RECORDS (ID, SUBSCRIPTION_ID, CHARGE_AMOUNT, CURRENCY, STATUS, PERIOD_DATE, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, 'pending', :5, SYSDATE, SYSDATE)`,
      [id, subscriptionId, chargeAmount, currency, periodDate],
    );
  }

  async findPendingForCurrentMonth(): Promise<BillingRecordWithRelations[]> {
    const rows = await this.dataSource.query<any[]>(
      `SELECT
        br.ID AS "id", br.SUBSCRIPTION_ID AS "subscriptionId", br.CHARGE_AMOUNT AS "chargeAmount",
        br.CURRENCY AS "currency", br.STATUS AS "status", br.PERIOD_DATE AS "periodDate",
        br.LOCKED_AT AS "lockedAt", br.CHARGED_AT AS "chargedAt",
        br.STRIPE_PAYMENT_INTENT_ID AS "stripePaymentIntentId", br.FAILURE_MESSAGE AS "failureMessage",
        br.CREATED_AT AS "createdAt", br.UPDATED_AT AS "updatedAt",
        ss.ID AS "subId", ss.CUSTOMER_ID AS "customerId", ss.DEFAULT_PM_ID AS "defaultPaymentMethodId",
        sc.STRIPE_CUSTOMER_ID AS "stripeCustomerId"
       FROM BILLING_RECORDS br
       JOIN STRIPE_SUBSCRIPTIONS ss ON ss.ID = br.SUBSCRIPTION_ID
       JOIN STRIPE_CUSTOMERS sc ON sc.ID = ss.CUSTOMER_ID
       WHERE br.STATUS = 'pending'
         AND TRUNC(br.PERIOD_DATE, 'MM') = TRUNC(SYSDATE, 'MM')`,
    );
    return rows.map(this.mapToRelations);
  }

  async findLockedForCurrentMonth(): Promise<BillingRecordWithRelations[]> {
    const rows = await this.dataSource.query<any[]>(
      `SELECT
        br.ID AS "id", br.SUBSCRIPTION_ID AS "subscriptionId", br.CHARGE_AMOUNT AS "chargeAmount",
        br.CURRENCY AS "currency", br.STATUS AS "status", br.PERIOD_DATE AS "periodDate",
        br.LOCKED_AT AS "lockedAt", br.CHARGED_AT AS "chargedAt",
        br.STRIPE_PAYMENT_INTENT_ID AS "stripePaymentIntentId", br.FAILURE_MESSAGE AS "failureMessage",
        br.CREATED_AT AS "createdAt", br.UPDATED_AT AS "updatedAt",
        ss.ID AS "subId", ss.CUSTOMER_ID AS "customerId", ss.DEFAULT_PM_ID AS "defaultPaymentMethodId",
        sc.STRIPE_CUSTOMER_ID AS "stripeCustomerId"
       FROM BILLING_RECORDS br
       JOIN STRIPE_SUBSCRIPTIONS ss ON ss.ID = br.SUBSCRIPTION_ID
       JOIN STRIPE_CUSTOMERS sc ON sc.ID = ss.CUSTOMER_ID
       WHERE br.STATUS = 'locked'
         AND TRUNC(br.PERIOD_DATE, 'MM') = TRUNC(SYSDATE, 'MM')`,
    );
    return rows.map(this.mapToRelations);
  }

  async lockAll(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const quoted = ids.map((id) => `'${id}'`).join(',');
    await this.dataSource.query(
      `UPDATE BILLING_RECORDS SET STATUS = 'locked', LOCKED_AT = SYSDATE, UPDATED_AT = SYSDATE WHERE ID IN (${quoted})`,
    );
  }

  async markCharged(id: string, stripePaymentIntentId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE BILLING_RECORDS SET STATUS = 'charged', CHARGED_AT = SYSDATE, STRIPE_PAYMENT_INTENT_ID = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [stripePaymentIntentId, id],
    );
  }

  async markFailed(id: string, failureMessage: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE BILLING_RECORDS SET STATUS = 'failed', FAILURE_MESSAGE = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [failureMessage, id],
    );
  }

  async findBySubscriptionId(subscriptionId: string): Promise<BillingRecord[]> {
    return this.dataSource.query<BillingRecord[]>(
      `SELECT ${BILLING_RECORD_SELECT} FROM BILLING_RECORDS WHERE SUBSCRIPTION_ID = :1 ORDER BY PERIOD_DATE DESC`,
      [subscriptionId],
    );
  }

  async findLatestBySubscriptionId(subscriptionId: string): Promise<BillingRecord | null> {
    const [row] = await this.dataSource.query<BillingRecord[]>(
      `SELECT ${BILLING_RECORD_SELECT} FROM BILLING_RECORDS WHERE SUBSCRIPTION_ID = :1 AND ROWNUM = 1 ORDER BY PERIOD_DATE DESC`,
      [subscriptionId],
    );
    return row ?? null;
  }

  private mapToRelations(row: any): BillingRecordWithRelations {
    const billingRecord: BillingRecord = {
      id: row.id,
      subscriptionId: row.subscriptionId,
      chargeAmount: row.chargeAmount,
      currency: row.currency,
      status: row.status,
      periodDate: row.periodDate,
      lockedAt: row.lockedAt,
      chargedAt: row.chargedAt,
      stripePaymentIntentId: row.stripePaymentIntentId,
      failureMessage: row.failureMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } as BillingRecord;

    return {
      billingRecord,
      subscription: {
        id: row.subId,
        customerId: row.customerId,
        defaultPaymentMethodId: row.defaultPaymentMethodId ?? null,
      },
      customer: {
        stripeCustomerId: row.stripeCustomerId,
      },
    };
  }
}
