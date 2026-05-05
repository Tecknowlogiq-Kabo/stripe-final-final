import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripePaymentMethod } from '../entities/stripe-payment-method.entity';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { StripeService } from '../stripe/stripe.service';
import { RedisService, CacheKeys, CacheTtl } from '../redis/redis.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const CUSTOMER_SELECT = `ID AS "id", STRIPE_CUSTOMER_ID AS "stripeCustomerId", EMAIL AS "email", NAME AS "name", PHONE AS "phone", METADATA AS "metadata", IDEMPOTENCY_KEY AS "idempotencyKey", USER_ID AS "userId", IS_DELETED AS "isDeleted", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;
const PM_SELECT = `ID AS "id", STRIPE_PM_ID AS "stripePaymentMethodId", TYPE AS "type", LAST4 AS "last4", BRAND AS "brand", EXP_MONTH AS "expMonth", EXP_YEAR AS "expYear", FINGERPRINT AS "fingerprint", DETAILS AS "details", BILLING_DETAILS AS "billingDetails", CARD_WALLET_TYPE AS "cardWalletType", COUNTRY AS "country", FUNDING AS "funding", IS_DEFAULT AS "isDefault", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;
const SUB_SELECT = `ID AS "id", STRIPE_SUB_ID AS "stripeSubscriptionId", STATUS AS "status", CURRENT_PERIOD_START AS "currentPeriodStart", CURRENT_PERIOD_END AS "currentPeriodEnd", CANCEL_AT_PERIOD_END AS "cancelAtPeriodEnd", TRIAL_END AS "trialEnd", TRIAL_START AS "trialStart", STRIPE_PRICE_ID AS "stripePriceId", DEFAULT_PM_ID AS "defaultPaymentMethodId", METADATA AS "metadata", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly redis: RedisService,
  ) {}

  async create(
    dto: CreateCustomerDto,
    idempotencyKey: string,
    userId: string,
  ): Promise<StripeCustomer> {
    const [existing] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE IDEMPOTENCY_KEY = :1 AND ROWNUM = 1`,
      [idempotencyKey],
    );
    if (existing) {
      this.logger.log({ message: 'Returning cached customer', idempotencyKey });
      return existing;
    }

    const [emailExists] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE EMAIL = :1 AND IS_DELETED = 0 AND ROWNUM = 1`,
      [dto.email],
    );
    if (emailExists) {
      throw new ConflictException('A customer with this email already exists');
    }

    const stripeCustomer = await this.stripeService.customers.create(
      {
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        metadata: dto.metadata,
      },
      { idempotencyKey },
    );

    this.logger.log({
      message: 'Stripe customer created',
      stripeCustomerId: stripeCustomer.id,
    });

    const id = randomUUID();
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `INSERT INTO STRIPE_CUSTOMERS (ID, STRIPE_CUSTOMER_ID, EMAIL, NAME, PHONE, METADATA, IDEMPOTENCY_KEY, USER_ID, IS_DELETED, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, 0, SYSDATE, SYSDATE)`,
        [
          id,
          stripeCustomer.id,
          dto.email,
          dto.name ?? null,
          dto.phone ?? null,
          dto.metadata ? JSON.stringify(dto.metadata) : null,
          idempotencyKey,
          userId,
        ],
      );
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      // Prevent orphaned Stripe customer when local insert fails
      this.stripeService.customers.del(stripeCustomer.id).catch((cleanupErr: Error) =>
        this.logger.error({
          message: 'Failed to clean up orphaned Stripe customer',
          stripeCustomerId: stripeCustomer.id,
          error: cleanupErr.message,
        }),
      );
      throw err;
    } finally {
      await runner.release();
    }

    return this.findById(id);
  }

  async findByUserId(userId: string): Promise<StripeCustomer | null> {
    const [customer] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE USER_ID = :1 AND IS_DELETED = 0 AND ROWNUM = 1`,
      [userId],
    );
    if (!customer) return null;
    return this.findById(customer.id);
  }

  async findById(id: string): Promise<StripeCustomer> {
    const cached = await this.redis.get<StripeCustomer>(CacheKeys.customer(id));
    if (cached) return cached;

    const [customer] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1 AND IS_DELETED = 0`,
      [id],
    );
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    const paymentMethods = await this.dataSource.query<StripePaymentMethod[]>(
      `SELECT ${PM_SELECT} FROM STRIPE_PAYMENT_METHODS WHERE CUSTOMER_ID = :1 ORDER BY IS_DEFAULT DESC, CREATED_AT DESC`,
      [id],
    );
    const subscriptions = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1 ORDER BY CREATED_AT DESC`,
      [id],
    );

    customer.paymentMethods = paymentMethods;
    customer.subscriptions = subscriptions;

    await this.redis.set(CacheKeys.customer(id), customer, CacheTtl.CUSTOMER);
    return customer;
  }

  async findByStripeId(stripeCustomerId: string): Promise<StripeCustomer> {
    const cached = await this.redis.get<StripeCustomer>(CacheKeys.customerByStripe(stripeCustomerId));
    if (cached) return cached;

    const [row] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE STRIPE_CUSTOMER_ID = :1 AND IS_DELETED = 0`,
      [stripeCustomerId],
    );
    if (!row) {
      throw new NotFoundException(
        `Customer with Stripe ID ${stripeCustomerId} not found`,
      );
    }

    // Fetch full object (with payment methods + subscriptions) so cached shape
    // matches findById — important for webhook handlers that use this result
    const full = await this.findById(row.id);
    await this.redis.set(CacheKeys.customerByStripe(stripeCustomerId), full, CacheTtl.CUSTOMER);
    return full;
  }

  async findByEmail(email: string): Promise<StripeCustomer | null> {
    const [customer] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE EMAIL = :1 AND IS_DELETED = 0`,
      [email],
    );
    return customer ?? null;
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    idempotencyKey: string,
  ): Promise<StripeCustomer> {
    const customer = await this.findById(id);

    await this.stripeService.customers.update(
      customer.stripeCustomerId,
      {
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        metadata: dto.metadata,
      },
      { idempotencyKey },
    );

    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET EMAIL = :1, NAME = :2, PHONE = :3, METADATA = :4, UPDATED_AT = SYSDATE WHERE ID = :5`,
      [
        dto.email ?? customer.email,
        dto.name !== undefined ? (dto.name ?? null) : (customer.name ?? null),
        dto.phone !== undefined
          ? (dto.phone ?? null)
          : (customer.phone ?? null),
        dto.metadata
          ? JSON.stringify(dto.metadata)
          : (customer.metadata ?? null),
        id,
      ],
    );

    await this.redis.del(
      CacheKeys.customer(id),
      CacheKeys.customerByStripe(customer.stripeCustomerId),
    );
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    const customer = await this.findById(id);
    await this.stripeService.customers.del(customer.stripeCustomerId);
    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET IS_DELETED = 1, UPDATED_AT = SYSDATE WHERE ID = :1`,
      [id],
    );
    await this.redis.del(
      CacheKeys.customer(id),
      CacheKeys.customerByStripe(customer.stripeCustomerId),
    );
    this.logger.log({ message: 'Customer soft deleted', customerId: id });
  }

  async createCustomerSession(
    customerId: string,
  ): Promise<{ clientSecret: string }> {
    const customer = await this.findById(customerId);
    const session = await this.stripeService.customerSessions.create({
      customer: customer.stripeCustomerId,
      components: {
        payment_element: {
          enabled: true,
          features: {
            payment_method_redisplay: 'enabled',
            payment_method_save: 'enabled',
            payment_method_save_usage: 'on_session',
          },
        },
      },
    });
    return { clientSecret: session.client_secret };
  }

  async syncFromStripe(stripeCustomerId: string): Promise<StripeCustomer> {
    const stripeCustomer = await this.stripeService.customers.retrieve(
      stripeCustomerId,
    );
    if (stripeCustomer.deleted) {
      throw new NotFoundException('Stripe customer has been deleted');
    }
    const customer = await this.findByStripeId(stripeCustomerId);

    await this.dataSource.query(
      `UPDATE STRIPE_CUSTOMERS SET EMAIL = :1, NAME = :2, PHONE = :3, UPDATED_AT = SYSDATE WHERE ID = :4`,
      [
        stripeCustomer.email ?? customer.email,
        stripeCustomer.name ?? customer.name,
        stripeCustomer.phone ?? customer.phone,
        customer.id,
      ],
    );

    await this.redis.del(
      CacheKeys.customer(customer.id),
      CacheKeys.customerByStripe(stripeCustomerId),
    );
    return this.findById(customer.id);
  }
}
