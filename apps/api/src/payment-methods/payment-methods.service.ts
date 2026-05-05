import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import Stripe from 'stripe';

const PM_TYPE_COUNTRY: Record<string, string> = {
  us_bank_account: 'US',
  bacs_debit: 'GB',
  au_becs_debit: 'AU',
  acss_debit: 'CA',
  ideal: 'NL',
  bancontact: 'BE',
  eps: 'AT',
};

const PM_SELECT = `ID AS "id", STRIPE_PM_ID AS "stripePaymentMethodId", TYPE AS "type", LAST4 AS "last4", BRAND AS "brand", EXP_MONTH AS "expMonth", EXP_YEAR AS "expYear", FINGERPRINT AS "fingerprint", DETAILS AS "details", BILLING_DETAILS AS "billingDetails", CARD_WALLET_TYPE AS "cardWalletType", COUNTRY AS "country", FUNDING AS "funding", CUSTOMER_ID AS "customerId", IS_DEFAULT AS "isDefault", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async listByCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: StripePaymentMethod[]; total: number; page: number; limit: number }> {
    await this.customersService.findById(customerId);

    const [countResult] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS "cnt" FROM STRIPE_PAYMENT_METHODS WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
    const total = Number(countResult.cnt);

    const offset = (page - 1) * limit;
    const data = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE CUSTOMER_ID = :1 ORDER BY IS_DEFAULT DESC, CREATED_AT DESC OFFSET :2 ROWS FETCH NEXT :3 ROWS ONLY`,
      [customerId, offset, limit],
    );

    return { data, total, page, limit };
  }

  async detach(id: string): Promise<void> {
    const [pm] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1 AND ROWNUM = 1`,
      [id],
    );
    if (!pm) throw new NotFoundException(`PaymentMethod ${id} not found`);

    await this.stripeService.paymentMethods.detach(pm.stripePaymentMethodId);
    await this.dataSource.query(
      `DELETE FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
      [id],
    );
    this.logger.log({ message: 'PaymentMethod detached', paymentMethodId: id });
  }

  async setDefault(customerId: string, paymentMethodId: string): Promise<void> {
    await this.customersService.findById(customerId);
    const [pm] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1 AND CUSTOMER_ID = :2 AND ROWNUM = 1`,
      [paymentMethodId, customerId],
    );
    if (!pm) throw new NotFoundException(`PaymentMethod ${paymentMethodId} not found`);

    const customer = await this.customersService.findById(customerId);
    await this.stripeService.customers.update(customer.stripeCustomerId, {
      invoice_settings: { default_payment_method: pm.stripePaymentMethodId },
    });

    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_METHODS SET IS_DEFAULT = 0, UPDATED_AT = SYSDATE WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_METHODS SET IS_DEFAULT = 1, UPDATED_AT = SYSDATE WHERE ID = :1`,
      [paymentMethodId],
    );
  }

  async syncFromStripe(
    stripePaymentMethodId: string,
    customerId: string,
  ): Promise<StripePaymentMethod> {
    const customer = await this.customersService.findById(customerId);
    const stripePM = await this.stripeService.paymentMethods.retrieve(stripePaymentMethodId);

    const [existing] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE STRIPE_PM_ID = :1 AND ROWNUM = 1`,
      [stripePaymentMethodId],
    );

    const fields = this.extractPmFields(stripePM);
    if (existing) {
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
          existing.id,
        ],
      );
      const [updated] = await this.dataSource.query<StripePaymentMethod[]>(
        `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
        [existing.id],
      );
      return updated;
    }

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
        customer.id,
      ],
    );
    const [created] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
      [id],
    );
    return created;
  }

  async syncFromStripeById(stripePaymentMethodId: string): Promise<void> {
    const stripePM = await this.stripeService.paymentMethods.retrieve(stripePaymentMethodId);
    if (!stripePM.customer) return;
    await this.upsertFromStripeEvent(stripePM);
  }

  async upsertFromStripeEvent(
    stripePM: Stripe.PaymentMethod,
    customerId?: string,
  ): Promise<void> {
    if (!stripePM.customer) return;

    let customer = null;
    try {
      customer = await this.customersService.findByStripeId(
        stripePM.customer as string,
      );
    } catch {
      return;
    }

    const [existing] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE STRIPE_PM_ID = :1 AND ROWNUM = 1`,
      [stripePM.id],
    );

    const fields = this.extractPmFields(stripePM);
    if (existing) {
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
          existing.id,
        ],
      );
    } else {
      const id = randomUUID();
      await this.dataSource.query(
        `INSERT INTO STRIPE_PAYMENT_METHODS (ID, STRIPE_PM_ID, TYPE, LAST4, BRAND, EXP_MONTH, EXP_YEAR, FINGERPRINT, DETAILS, BILLING_DETAILS, CARD_WALLET_TYPE, COUNTRY, FUNDING, CUSTOMER_ID, IS_DEFAULT, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13, :14, 0, SYSDATE, SYSDATE)`,
        [
          id,
          stripePM.id,
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
          customer.id,
        ],
      );
    }
  }

  async removeByStripeId(stripePaymentMethodId: string): Promise<void> {
    const [pm] = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE STRIPE_PM_ID = :1 AND ROWNUM = 1`,
      [stripePaymentMethodId],
    );
    if (pm) {
      await this.dataSource.query(
        `DELETE FROM STRIPE_PAYMENT_METHODS WHERE ID = :1`,
        [pm.id],
      );
    }
  }

  private extractPmFields(stripePM: Stripe.PaymentMethod): Partial<StripePaymentMethod> {
    const typeObj = (stripePM as unknown as Record<string, unknown>)[stripePM.type];

    const country: string | undefined =
      stripePM.card?.country ??
      (stripePM.sepa_debit as { country?: string } | undefined)?.country ??
      PM_TYPE_COUNTRY[stripePM.type] ??
      (stripePM.billing_details?.address?.country ?? undefined) ??
      undefined;

    return {
      type: stripePM.type,
      ...(stripePM.card && {
        last4: stripePM.card.last4,
        brand: stripePM.card.brand,
        expMonth: stripePM.card.exp_month,
        expYear: stripePM.card.exp_year,
        fingerprint: stripePM.card.fingerprint ?? undefined,
        cardWalletType: stripePM.card.wallet?.type ?? undefined,
        funding: stripePM.card.funding ?? undefined,
      }),
      details: typeObj != null ? JSON.stringify(typeObj) : undefined,
      billingDetails: stripePM.billing_details
        ? JSON.stringify(stripePM.billing_details)
        : undefined,
      country,
    };
  }
}
