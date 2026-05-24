import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { PM_SELECT } from '../database/query-constants';
import { withTransaction } from '../database/transaction.helper';

@Injectable()
export class PaymentMethodsRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findById(id: string): Promise<StripePaymentMethod | null> {
    const [row] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1 AND ROWNUM = 1`,
      [id],
    );
    return row ?? null;
  }

  async findByStripeId(stripePaymentMethodId: string): Promise<StripePaymentMethod | null> {
    const [row] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE STRIPE_PM_ID = :1 AND ROWNUM = 1`,
      [stripePaymentMethodId],
    );
    return row ?? null;
  }

  async findByIdAndCustomer(id: string, customerId: string): Promise<StripePaymentMethod | null> {
    const [row] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1 AND CUSTOMER_ID = :2 AND ROWNUM = 1`,
      [id, customerId],
    );
    return row ?? null;
  }

  async listByCustomer(
    customerId: string,
    offset: number,
    limit: number,
  ): Promise<{ data: StripePaymentMethod[]; total: number }> {
    const [countResult] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS "cnt" FROM STRIPE_PAYMENT_METHODS WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
    const total = Number(countResult.cnt);

    const data = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE CUSTOMER_ID = :1 ORDER BY IS_DEFAULT DESC, CREATED_AT DESC OFFSET :2 ROWS FETCH NEXT :3 ROWS ONLY`,
      [customerId, offset, limit],
    );

    return { data, total };
  }

  async deleteById(id: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
      [id],
    );
  }

  async clearDefaultByCustomer(customerId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_METHODS SET IS_DEFAULT = 0, UPDATED_AT = SYSDATE WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
  }

  async setDefault(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_METHODS SET IS_DEFAULT = 1, UPDATED_AT = SYSDATE WHERE ID = :1`,
      [id],
    );
  }

  async setDefaultAtomic(paymentMethodId: string, customerId: string): Promise<void> {
    await withTransaction(this.dataSource, async (runner) => {
      await runner.query(
        `UPDATE STRIPE_PAYMENT_METHODS SET IS_DEFAULT = 0, UPDATED_AT = SYSDATE WHERE CUSTOMER_ID = :1`,
        [customerId],
      );
      await runner.query(
        `UPDATE STRIPE_PAYMENT_METHODS SET IS_DEFAULT = 1, UPDATED_AT = SYSDATE WHERE ID = :1`,
        [paymentMethodId],
      );
    });
  }

  async updateFields(
    id: string,
    fields: {
      type: string;
      last4?: string | null;
      brand?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
      fingerprint?: string | null;
      details?: string | null;
      billingDetails?: string | null;
      cardWalletType?: string | null;
      country?: string | null;
      funding?: string | null;
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_METHODS SET TYPE = :1, LAST4 = :2, BRAND = :3, EXP_MONTH = :4, EXP_YEAR = :5, FINGERPRINT = :6, DETAILS = :7, BILLING_DETAILS = :8, CARD_WALLET_TYPE = :9, COUNTRY = :10, FUNDING = :11, UPDATED_AT = SYSDATE WHERE ID = :12`,
      [
        fields.type,
        fields.last4 ?? null,
        fields.brand ?? null,
        fields.expMonth ?? null,
        fields.expYear ?? null,
        fields.fingerprint ?? null,
        fields.details ?? null,
        fields.billingDetails ?? null,
        fields.cardWalletType ?? null,
        fields.country ?? null,
        fields.funding ?? null,
        id,
      ],
    );
  }

  async insertNew(
    stripePaymentMethodId: string,
    customerId: string,
    fields: {
      type: string;
      last4?: string | null;
      brand?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
      fingerprint?: string | null;
      details?: string | null;
      billingDetails?: string | null;
      cardWalletType?: string | null;
      country?: string | null;
      funding?: string | null;
    },
  ): Promise<StripePaymentMethod> {
    const id = randomUUID();
    await this.dataSource.query(
      `INSERT INTO STRIPE_PAYMENT_METHODS (ID, STRIPE_PM_ID, TYPE, LAST4, BRAND, EXP_MONTH, EXP_YEAR, FINGERPRINT, DETAILS, BILLING_DETAILS, CARD_WALLET_TYPE, COUNTRY, FUNDING, CUSTOMER_ID, IS_DEFAULT, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13, :14, 0, SYSDATE, SYSDATE)`,
      [
        id,
        stripePaymentMethodId,
        fields.type,
        fields.last4 ?? null,
        fields.brand ?? null,
        fields.expMonth ?? null,
        fields.expYear ?? null,
        fields.fingerprint ?? null,
        fields.details ?? null,
        fields.billingDetails ?? null,
        fields.cardWalletType ?? null,
        fields.country ?? null,
        fields.funding ?? null,
        customerId,
      ],
    );
    const [created] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
      [id],
    );
    return created;
  }

  async upsertFromStripeEvent(
    stripePaymentMethodId: string,
    customerId: string,
    fields: {
      type: string;
      last4?: string | null;
      brand?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
      fingerprint?: string | null;
      details?: string | null;
      billingDetails?: string | null;
      cardWalletType?: string | null;
      country?: string | null;
      funding?: string | null;
    },
  ): Promise<void> {
    await withTransaction(this.dataSource, async (runner) => {
      const existing: StripePaymentMethod | undefined = (
        await runner.query(
          `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE STRIPE_PM_ID = :1 AND ROWNUM = 1`,
          [stripePaymentMethodId],
        ) as StripePaymentMethod[]
      )[0];

      if (existing) {
        await runner.query(
          `UPDATE STRIPE_PAYMENT_METHODS SET TYPE = :1, LAST4 = :2, BRAND = :3, EXP_MONTH = :4, EXP_YEAR = :5, FINGERPRINT = :6, DETAILS = :7, BILLING_DETAILS = :8, CARD_WALLET_TYPE = :9, COUNTRY = :10, FUNDING = :11, UPDATED_AT = SYSDATE WHERE ID = :12`,
          [
            fields.type,
            fields.last4 ?? null,
            fields.brand ?? null,
            fields.expMonth ?? null,
            fields.expYear ?? null,
            fields.fingerprint ?? null,
            fields.details ?? null,
            fields.billingDetails ?? null,
            fields.cardWalletType ?? null,
            fields.country ?? null,
            fields.funding ?? null,
            existing.id,
          ],
        );
      } else {
        const id = randomUUID();
        await runner.query(
          `INSERT INTO STRIPE_PAYMENT_METHODS (ID, STRIPE_PM_ID, TYPE, LAST4, BRAND, EXP_MONTH, EXP_YEAR, FINGERPRINT, DETAILS, BILLING_DETAILS, CARD_WALLET_TYPE, COUNTRY, FUNDING, CUSTOMER_ID, IS_DEFAULT, CREATED_AT, UPDATED_AT)
           VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13, :14, 0, SYSDATE, SYSDATE)`,
          [
            id,
            stripePaymentMethodId,
            fields.type,
            fields.last4 ?? null,
            fields.brand ?? null,
            fields.expMonth ?? null,
            fields.expYear ?? null,
            fields.fingerprint ?? null,
            fields.details ?? null,
            fields.billingDetails ?? null,
            fields.cardWalletType ?? null,
            fields.country ?? null,
            fields.funding ?? null,
            customerId,
          ],
        );
      }
    });
  }
}
