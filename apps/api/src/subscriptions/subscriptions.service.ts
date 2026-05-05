import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { RedisService, CacheKeys, CacheTtl } from '../redis/redis.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import Stripe from 'stripe';

const SUB_SELECT = `ID AS "id", STRIPE_SUB_ID AS "stripeSubscriptionId", STATUS AS "status", CURRENT_PERIOD_START AS "currentPeriodStart", CURRENT_PERIOD_END AS "currentPeriodEnd", CANCEL_AT_PERIOD_END AS "cancelAtPeriodEnd", TRIAL_END AS "trialEnd", TRIAL_START AS "trialStart", STRIPE_PRICE_ID AS "stripePriceId", DEFAULT_PM_ID AS "defaultPaymentMethodId", CUSTOMER_ID AS "customerId", METADATA AS "metadata", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

const CUSTOMER_SELECT = `ID AS "id", STRIPE_CUSTOMER_ID AS "stripeCustomerId", EMAIL AS "email", NAME AS "name", PHONE AS "phone", METADATA AS "metadata", IDEMPOTENCY_KEY AS "idempotencyKey", IS_DELETED AS "isDeleted", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

const PLAN_SELECT = `ID AS "id", STRIPE_PRICE_ID AS "stripePriceId", STRIPE_PRODUCT_ID AS "stripeProductId", NAME AS "name", DESCRIPTION AS "description", AMOUNT AS "amount", CURRENCY AS "currency", INTERVAL_TYPE AS "interval", INTERVAL_COUNT AS "intervalCount", IS_ACTIVE AS "isActive", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
    private readonly redis: RedisService,
  ) {}

  async create(
    dto: CreateSubscriptionDto,
    idempotencyKey: string,
  ): Promise<StripeSubscription> {
    const customer = await this.customersService.findById(dto.customerId);

    const [existingForCustomer] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1 AND STRIPE_PRICE_ID = :2 AND STATUS = 'active' AND ROWNUM = 1`,
      [dto.customerId, dto.priceId],
    );
    if (existingForCustomer) {
      this.logger.log({ message: 'Returning existing active subscription', customerId: dto.customerId });
      return this.findById(existingForCustomer.id);
    }

    const createParams: Stripe.SubscriptionCreateParams = {
      customer: customer.stripeCustomerId,
      items: [{ price: dto.priceId }],
      metadata: { ...dto.metadata, internal_customer_id: customer.id },
      expand: ['latest_invoice.payment_intent'],
    };
    if (dto.paymentMethodId) {
      createParams.default_payment_method = dto.paymentMethodId;
    }
    if (dto.trialPeriodDays) {
      createParams.trial_period_days = dto.trialPeriodDays;
    }

    const stripeSub = await this.stripeService.subscriptions.create(
      createParams,
      { idempotencyKey },
    );

    const [alreadySaved] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE STRIPE_SUB_ID = :1 AND ROWNUM = 1`,
      [stripeSub.id],
    );
    if (alreadySaved) return this.findById(alreadySaved.id);

    this.logger.log({
      message: 'Subscription created',
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      customerId: customer.id,
    });

    const id = randomUUID();
    await this.dataSource.query(
      `INSERT INTO STRIPE_SUBSCRIPTIONS (ID, STRIPE_SUB_ID, STATUS, CURRENT_PERIOD_START, CURRENT_PERIOD_END, CANCEL_AT_PERIOD_END, TRIAL_START, TRIAL_END, STRIPE_PRICE_ID, DEFAULT_PM_ID, CUSTOMER_ID, METADATA, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, SYSDATE, SYSDATE)`,
      [
        id,
        stripeSub.id,
        stripeSub.status,
        new Date(stripeSub.current_period_start * 1000),
        new Date(stripeSub.current_period_end * 1000),
        stripeSub.cancel_at_period_end ? 1 : 0,
        stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : null,
        stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
        dto.priceId,
        dto.paymentMethodId ?? null,
        customer.id,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
      ],
    );

    return this.findById(id);
  }

  async findById(id: string): Promise<StripeSubscription> {
    const [sub] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE ID = :1`,
      [id],
    );
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);

    const [customer] = await this.dataSource.query<any[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1`,
      [(sub as any).customerId],
    );
    (sub as any).customer = customer ?? null;

    return sub;
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<StripeSubscription | null> {
    const [sub] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE STRIPE_SUB_ID = :1 AND ROWNUM = 1`,
      [stripeSubscriptionId],
    );
    return sub ?? null;
  }

  async listByCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: StripeSubscription[]; total: number; page: number; limit: number }> {
    const [countResult] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS "cnt" FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1`,
      [customerId],
    );
    const total = Number(countResult.cnt);

    const offset = (page - 1) * limit;
    const data = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE CUSTOMER_ID = :1 ORDER BY CREATED_AT DESC OFFSET :2 ROWS FETCH NEXT :3 ROWS ONLY`,
      [customerId, offset, limit],
    );

    return { data, total, page, limit };
  }

  async update(
    id: string,
    dto: UpdateSubscriptionDto,
    idempotencyKey: string,
  ): Promise<StripeSubscription> {
    const sub = await this.findById(id);
    const updateParams: Stripe.SubscriptionUpdateParams = {};

    if (dto.priceId) {
      const stripeSub = await this.stripeService.subscriptions.retrieve(
        sub.stripeSubscriptionId,
      );
      updateParams.items = [
        { id: stripeSub.items.data[0].id, price: dto.priceId },
      ];
    }
    if (dto.paymentMethodId) {
      updateParams.default_payment_method = dto.paymentMethodId;
    }
    if (dto.cancelAtPeriodEnd !== undefined) {
      updateParams.cancel_at_period_end = dto.cancelAtPeriodEnd;
    }
    if (dto.metadata) {
      updateParams.metadata = dto.metadata;
    }

    const updated = await this.stripeService.subscriptions.update(
      sub.stripeSubscriptionId,
      updateParams,
      { idempotencyKey },
    );

    await this.dataSource.query(
      `UPDATE STRIPE_SUBSCRIPTIONS SET STRIPE_PRICE_ID = :1, DEFAULT_PM_ID = :2, CANCEL_AT_PERIOD_END = :3, STATUS = :4, UPDATED_AT = SYSDATE WHERE ID = :5`,
      [
        dto.priceId ?? (sub as any).stripePriceId,
        dto.paymentMethodId ?? (sub as any).defaultPaymentMethodId ?? null,
        dto.cancelAtPeriodEnd !== undefined ? (dto.cancelAtPeriodEnd ? 1 : 0) : (sub as any).cancelAtPeriodEnd ? 1 : 0,
        updated.status,
        id,
      ],
    );

    return this.findById(id);
  }

  async cancel(id: string): Promise<StripeSubscription> {
    const sub = await this.findById(id);
    const cancelled = await this.stripeService.subscriptions.cancel(
      sub.stripeSubscriptionId,
    );

    await this.dataSource.query(
      `UPDATE STRIPE_SUBSCRIPTIONS SET STATUS = :1, CANCEL_AT_PERIOD_END = :2, UPDATED_AT = SYSDATE WHERE ID = :3`,
      [cancelled.status, cancelled.cancel_at_period_end ? 1 : 0, id],
    );

    return this.findById(id);
  }

  async syncFromStripeEvent(stripeSub: Stripe.Subscription): Promise<void> {
    const [sub] = await this.dataSource.query<StripeSubscription[]>(
      `SELECT ${SUB_SELECT} FROM STRIPE_SUBSCRIPTIONS WHERE STRIPE_SUB_ID = :1 AND ROWNUM = 1`,
      [stripeSub.id],
    );

    if (sub) {
      await this.dataSource.query(
        `UPDATE STRIPE_SUBSCRIPTIONS SET STATUS = :1, CURRENT_PERIOD_START = :2, CURRENT_PERIOD_END = :3, CANCEL_AT_PERIOD_END = :4, TRIAL_START = :5, TRIAL_END = :6, DEFAULT_PM_ID = :7, UPDATED_AT = SYSDATE WHERE ID = :8`,
        [
          stripeSub.status,
          new Date(stripeSub.current_period_start * 1000),
          new Date(stripeSub.current_period_end * 1000),
          stripeSub.cancel_at_period_end ? 1 : 0,
          stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : (sub as any).trialStart ?? null,
          stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : (sub as any).trialEnd ?? null,
          stripeSub.default_payment_method as string ?? (sub as any).defaultPaymentMethodId ?? null,
          sub.id,
        ],
      );
      this.logger.log({
        message: 'Subscription synced from Stripe event',
        stripeSubscriptionId: stripeSub.id,
        status: stripeSub.status,
      });
      return;
    }

    try {
      const customer = await this.customersService.findByStripeId(
        stripeSub.customer as string,
      );
      const id = randomUUID();
      const priceId = stripeSub.items.data[0]?.price.id ?? '';
      await this.dataSource.query(
        `INSERT INTO STRIPE_SUBSCRIPTIONS (ID, STRIPE_SUB_ID, STATUS, CURRENT_PERIOD_START, CURRENT_PERIOD_END, CANCEL_AT_PERIOD_END, TRIAL_START, TRIAL_END, STRIPE_PRICE_ID, DEFAULT_PM_ID, CUSTOMER_ID, CREATED_AT, UPDATED_AT)
         VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, SYSDATE, SYSDATE)`,
        [
          id,
          stripeSub.id,
          stripeSub.status,
          new Date(stripeSub.current_period_start * 1000),
          new Date(stripeSub.current_period_end * 1000),
          stripeSub.cancel_at_period_end ? 1 : 0,
          stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : null,
          stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
          priceId,
          stripeSub.default_payment_method as string ?? null,
          customer.id,
        ],
      );
    } catch {
      return;
    }
  }

  async listPlans(activeOnly = true): Promise<SubscriptionPlan[]> {
    const cacheKey = CacheKeys.plans(activeOnly);
    const cached = await this.redis.get<SubscriptionPlan[]>(cacheKey);
    if (cached) return cached;

    const plans = activeOnly
      ? await this.dataSource.query<SubscriptionPlan[]>(
          `SELECT ${PLAN_SELECT} FROM SUBSCRIPTION_PLANS WHERE IS_ACTIVE = 1 ORDER BY AMOUNT ASC`,
        )
      : await this.dataSource.query<SubscriptionPlan[]>(
          `SELECT ${PLAN_SELECT} FROM SUBSCRIPTION_PLANS ORDER BY AMOUNT ASC`,
        );

    await this.redis.set(cacheKey, plans, CacheTtl.PLANS);
    return plans;
  }
}
