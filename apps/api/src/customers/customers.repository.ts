import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { CUSTOMER_SELECT, PM_SELECT, SUB_SELECT } from '../database/query-constants';
import { withTransaction } from '../database/transaction.helper';

@Injectable()
export class CustomersRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByIdempotencyKey(key: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE IDEMPOTENCY_KEY = :1 AND ROWNUM = 1`,
      [key],
    );
    return row ?? null;
  }

  async findActiveByEmail(email: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE EMAIL = :1 AND IS_DELETED = 0 AND ROWNUM = 1`,
      [email],
    );
    return row ?? null;
  }

  async findById(id: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1 AND IS_DELETED = 0`,
      [id],
    );
    return row ?? null;
  }

  /** Find a customer by ID regardless of IS_DELETED flag. Used by webhook sync handlers. */
  async findByIdWithoutDeleted(id: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1`,
      [id],
    );
    return row ?? null;
  }

  async findByUserId(userId: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE USER_ID = :1 AND IS_DELETED = 0 AND ROWNUM = 1`,
      [userId],
    );
    return row ?? null;
  }

  async findByStripeId(stripeCustomerId: string): Promise<StripeCustomer | null> {
    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE STRIPE_CUSTOMER_ID = :1 AND IS_DELETED = 0`,
      [stripeCustomerId],
    );
    return row ?? null;
  }

  async findPaymentMethodsByCustomer(customerId: string): Promise<StripePaymentMethod[]> {
    return this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE CUSTOMER_ID = :1 ORDER BY IS_DEFAULT DESC, CREATED_AT DESC`,
      [customerId],
    );
  }

  async findSubscriptionsByCustomer(customerId: string): Promise<StripeSubscription[]> {
    return this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1 ORDER BY CREATED_AT DESC`,
      [customerId],
    );
  }

  async insert(
    id: string,
    stripeCustomerId: string,
    email: string,
    name: string | null,
    phone: string | null,
    metadata: string | null,
    idempotencyKey: string,
    userId: string,
  ): Promise<void> {
    await withTransaction(this.dataSource, async (runner) => {
      await runner.query(
        `INSERT INTO STRIPE_CUSTOMERS (ID, STRIPE_CUSTOMER_ID, EMAIL, NAME, PHONE, METADATA, IDEMPOTENCY_KEY, USER_ID, IS_DELETED, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, 0, SYSDATE, SYSDATE)`,
        [id, stripeCustomerId, email, name, phone, metadata, idempotencyKey, userId],
      );
    });
  }

  async update(
    id: string,
    email: string,
    name: string | null,
    phone: string | null,
    metadata: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET EMAIL = :1, NAME = :2, PHONE = :3, METADATA = :4, UPDATED_AT = SYSDATE WHERE ID = :5`,
      [email, name, phone, metadata, id],
    );
  }

  async softDelete(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET IS_DELETED = 1, UPDATED_AT = SYSDATE WHERE ID = :1`,
      [id],
    );
  }

  async syncUpdate(
    id: string,
    email: string,
    name: string | null,
    phone: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET EMAIL = :1, NAME = :2, PHONE = :3, UPDATED_AT = SYSDATE WHERE ID = :4`,
      [email, name, phone, id],
    );
  }
}
