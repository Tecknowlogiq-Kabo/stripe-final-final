import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { SI_SELECT, CUSTOMER_SELECT } from '../database/query-constants';
import { withTransaction } from '../database/transaction.helper';

@Injectable()
export class SetupIntentsRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByIdempotencyKey(key: string): Promise<StripeSetupIntent | null> {
    const [row] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE IDEMPOTENCY_KEY = :1 AND ROWNUM = 1`,
      [key],
    );
    return row ?? null;
  }

  async findById(id: string): Promise<StripeSetupIntent | null> {
    const [row] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE ID = :1`,
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

  async findByStripeId(stripeSetupIntentId: string): Promise<StripeSetupIntent | null> {
    const [row] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE STRIPE_SI_ID = :1 AND ROWNUM = 1`,
      [stripeSetupIntentId],
    );
    return row ?? null;
  }

  async insert(
    id: string,
    stripeId: string,
    status: string,
    clientSecret: string,
    customerId: string,
    idempotencyKey: string,
    metadata: string | null,
    description: string | null,
    usage: string,
    paymentMethodTypes: string | null,
    nextAction: string | null,
    livemode: number,
  ): Promise<void> {
    await withTransaction(this.dataSource, async (runner) => {
      await runner.query(
        `INSERT INTO STRIPE_SETUP_INTENTS (ID, STRIPE_SI_ID, STATUS, CLIENT_SECRET, CUSTOMER_ID, IDEMPOTENCY_KEY, METADATA, DESCRIPTION, USAGE, PAYMENT_METHOD_TYPES, NEXT_ACTION, LIVEMODE, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, SYSDATE, SYSDATE)`,
        [id, stripeId, status, clientSecret, customerId, idempotencyKey, metadata, description, usage, paymentMethodTypes, nextAction, livemode],
      );
    });
  }

  async updateStatus(
    id: string,
    status: string,
    stripePaymentMethodId: string | null,
    lastSetupError: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_SETUP_INTENTS SET STATUS = :1, STRIPE_PM_ID = :2, LAST_SETUP_ERROR = :3, UPDATED_AT = SYSDATE WHERE ID = :4`,
      [status, stripePaymentMethodId, lastSetupError, id],
    );
  }

  async updateStatusById(id: string, status: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_SETUP_INTENTS SET STATUS = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [status, id],
    );
  }
}
