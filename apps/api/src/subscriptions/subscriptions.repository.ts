import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { SUB_SELECT, CUSTOMER_SELECT, PLAN_SELECT } from '../database/query-constants';
import { withTransaction } from '../database/transaction.helper';

@Injectable()
export class SubscriptionsRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findActiveByCustomerAndPrice(customerId: string, priceId: string): Promise<StripeSubscription | null> {
    const [row] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1 AND STRIPE_PRICE_ID = :2 AND STATUS = 'active' AND ROWNUM = 1`,
      [customerId, priceId],
    );
    return row ?? null;
  }

  async findById(id: string): Promise<StripeSubscription | null> {
    const [row] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE ID = :1`,
      [id],
    );
    return row ?? null;
  }

  async findCustomerById(id: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1`,
      [id],
    );
    return row ?? null;
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<StripeSubscription | null> {
    const [row] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE STRIPE_SUB_ID = :1 AND ROWNUM = 1`,
      [stripeSubscriptionId],
    );
    return row ?? null;
  }

  async listByCustomer(
    customerId: string,
    offset: number,
    limit: number,
  ): Promise<{ data: StripeSubscription[]; total: number }> {
    const [countResult] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS "cnt" FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
    const total = Number(countResult.cnt);

    const data = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1 ORDER BY CREATED_AT DESC OFFSET :2 ROWS FETCH NEXT :3 ROWS ONLY`,
      [customerId, offset, limit],
    );

    return { data, total };
  }

  async insert(
    id: string,
    stripeSubId: string,
    status: string,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: number,
    trialStart: Date | null,
    trialEnd: Date | null,
    priceId: string,
    defaultPaymentMethodId: string | null,
    customerId: string,
    metadata: string | null,
  ): Promise<void> {
    await withTransaction(this.dataSource, async (runner) => {
      await runner.query(
        `INSERT INTO STRIPE_SUBSCRIPTIONS (ID, STRIPE_SUB_ID, STATUS, CURRENT_PERIOD_START, CURRENT_PERIOD_END, CANCEL_AT_PERIOD_END, TRIAL_START, TRIAL_END, STRIPE_PRICE_ID, DEFAULT_PM_ID, CUSTOMER_ID, METADATA, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, SYSDATE, SYSDATE)`,
        [id, stripeSubId, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, trialStart, trialEnd, priceId, defaultPaymentMethodId, customerId, metadata],
      );
    });
  }

  async update(
    id: string,
    priceId: string,
    defaultPaymentMethodId: string | null,
    cancelAtPeriodEnd: number,
    status: string,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_SUBSCRIPTIONS SET STRIPE_PRICE_ID = :1, DEFAULT_PM_ID = :2, CANCEL_AT_PERIOD_END = :3, STATUS = :4, UPDATED_AT = SYSDATE WHERE ID = :5`,
      [priceId, defaultPaymentMethodId, cancelAtPeriodEnd, status, id],
    );
  }

  async updateCancel(id: string, status: string, cancelAtPeriodEnd: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_SUBSCRIPTIONS SET STATUS = :1, CANCEL_AT_PERIOD_END = :2, UPDATED_AT = SYSDATE WHERE ID = :3`,
      [status, cancelAtPeriodEnd, id],
    );
  }

  async syncUpdate(
    id: string,
    status: string,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: number,
    trialStart: Date | null,
    trialEnd: Date | null,
    defaultPaymentMethodId: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_SUBSCRIPTIONS SET STATUS = :1, CURRENT_PERIOD_START = :2, CURRENT_PERIOD_END = :3, CANCEL_AT_PERIOD_END = :4, TRIAL_START = :5, TRIAL_END = :6, DEFAULT_PM_ID = :7, UPDATED_AT = SYSDATE WHERE ID = :8`,
      [status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, trialStart, trialEnd, defaultPaymentMethodId, id],
    );
  }

  async insertFromStripeEvent(
    id: string,
    stripeSubId: string,
    status: string,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: number,
    trialStart: Date | null,
    trialEnd: Date | null,
    priceId: string,
    defaultPaymentMethodId: string | null,
    customerId: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO STRIPE_SUBSCRIPTIONS (ID, STRIPE_SUB_ID, STATUS, CURRENT_PERIOD_START, CURRENT_PERIOD_END, CANCEL_AT_PERIOD_END, TRIAL_START, TRIAL_END, STRIPE_PRICE_ID, DEFAULT_PM_ID, CUSTOMER_ID, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, SYSDATE, SYSDATE)`,
      [id, stripeSubId, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, trialStart, trialEnd, priceId, defaultPaymentMethodId, customerId],
    );
  }

  async listPlans(activeOnly: boolean): Promise<SubscriptionPlan[]> {
    if (activeOnly) {
      return this.dataSource.query<SubscriptionPlan[]>(
        `SELECT ${PLAN_SELECT} FROM SUBSCRIPTION_PLANS WHERE IS_ACTIVE = 1 ORDER BY AMOUNT ASC`,
      );
    }
    return this.dataSource.query<SubscriptionPlan[]>(
      `SELECT ${PLAN_SELECT} FROM SUBSCRIPTION_PLANS ORDER BY AMOUNT ASC`,
    );
  }
}
