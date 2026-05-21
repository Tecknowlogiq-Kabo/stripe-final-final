import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { withTransaction } from '../database/transaction.helper';
import { PI_SELECT, CUSTOMER_SELECT } from '../database/query-constants';

@Injectable()
export class PaymentIntentsRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByIdempotencyKey(key: string): Promise<StripePaymentIntent | null> {
    const [row] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE IDEMPOTENCY_KEY = :1 AND ROWNUM = 1`,
      [key],
    );
    return row ?? null;
  }

  async findById(id: string): Promise<StripePaymentIntent | null> {
    const [row] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE ID = :1`,
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

  async findByStripeId(stripePaymentIntentId: string): Promise<StripePaymentIntent | null> {
    const [row] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE STRIPE_PI_ID = :1 AND ROWNUM = 1`,
      [stripePaymentIntentId],
    );
    return row ?? null;
  }

  async findByCustomer(
    customerId: string,
    filters: {
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      sortBy?: string;
      sortOrder?: string;
      offset: number;
      limit: number;
    },
  ): Promise<{ data: StripePaymentIntent[]; total: number }> {
    const conditions = ['CUSTOMER_ID = :1'];
    const params: unknown[] = [customerId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`STATUS = :${idx}`);
      params.push(filters.status);
      idx++;
    }

    if (filters.dateFrom && filters.dateTo) {
      conditions.push(`CREATED_AT BETWEEN :${idx} AND :${idx + 1}`);
      params.push(new Date(filters.dateFrom), new Date(filters.dateTo));
      idx += 2;
    } else if (filters.dateFrom) {
      conditions.push(`CREATED_AT >= :${idx}`);
      params.push(new Date(filters.dateFrom));
      idx++;
    } else if (filters.dateTo) {
      conditions.push(`CREATED_AT <= :${idx}`);
      params.push(new Date(filters.dateTo));
      idx++;
    }

    const whereClause = conditions.join(' AND ');
    const sortCol = filters.sortBy === 'amount' ? 'AMOUNT' : 'CREATED_AT';
    const sortDir = filters.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const [countResult] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS "cnt" FROM STRIPE_PAYMENT_INTENTS WHERE ${whereClause}`,
      [...params],
    );
    const total = Number(countResult.cnt);

    const offsetIdx = idx;
    const limitIdx = idx + 1;
    const data = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE ${whereClause} ORDER BY ${sortCol} ${sortDir} OFFSET :${offsetIdx} ROWS FETCH NEXT :${limitIdx} ROWS ONLY`,
      [...params, filters.offset, filters.limit],
    );

    return { data, total };
  }

  async insert(
    id: string,
    stripeId: string,
    amount: number,
    currency: string,
    status: string,
    clientSecret: string,
    customerId: string | null,
    paymentMethodId: string | null,
    idempotencyKey: string,
    metadata: string | null,
    description: string | null,
    setupFutureUsage: string | null,
    paymentMethodTypes: string | null,
    amountReceived: number | null,
    amountCapturable: number | null,
    nextAction: string | null,
    livemode: number,
  ): Promise<void> {
    await withTransaction(this.dataSource, async (runner) => {
      await runner.query(
        `INSERT INTO STRIPE_PAYMENT_INTENTS (ID, STRIPE_PI_ID, AMOUNT, CURRENCY, STATUS, CLIENT_SECRET, CUSTOMER_ID, STRIPE_PM_ID, IDEMPOTENCY_KEY, METADATA, DESCRIPTION, SETUP_FUTURE_USAGE, PAYMENT_METHOD_TYPES, AMOUNT_RECEIVED, AMOUNT_CAPTURABLE, NEXT_ACTION, LIVEMODE, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13, :14, :15, :16, :17, SYSDATE, SYSDATE)`,
        [id, stripeId, amount, currency, status, clientSecret, customerId, paymentMethodId, idempotencyKey, metadata, description, setupFutureUsage, paymentMethodTypes, amountReceived, amountCapturable, nextAction, livemode],
      );
    });
  }

  async updateMetadata(id: string, metadata: string | null, description: string | null): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_INTENTS SET METADATA = :1, DESCRIPTION = :2, UPDATED_AT = SYSDATE WHERE ID = :3`,
      [metadata, description, id],
    );
  }

  async updateStatus(
    id: string,
    status: string,
    errorCode: string | null,
    errorDeclineCode: string | null,
    errorMessage: string | null,
    nextAction: string | null,
    amountReceived: number | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_INTENTS SET STATUS = :1, ERROR_CODE = :2, ERROR_DECLINE_CODE = :3, ERROR_MESSAGE = :4, NEXT_ACTION = :5, AMOUNT_RECEIVED = :6, UPDATED_AT = SYSDATE WHERE ID = :7`,
      [status, errorCode, errorDeclineCode, errorMessage, nextAction, amountReceived, id],
    );
  }
}
