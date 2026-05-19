import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { RedisService, CacheKeys, CacheTtl } from '../redis/redis.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import Stripe from 'stripe';
import { SubscriptionsRepository } from './subscriptions.repository';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
    private readonly redis: RedisService,
  ) {}

  async create(
    dto: CreateSubscriptionDto,
    idempotencyKey: string,
  ): Promise<StripeSubscription> {
    const customer = await this.customersService.findById(dto.customerId);

    const existingForCustomer = await this.repo.findActiveByCustomerAndPrice(dto.customerId, dto.priceId);
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

    const alreadySaved = await this.repo.findByStripeId(stripeSub.id);
    if (alreadySaved) return this.findById(alreadySaved.id);

    this.logger.log({
      message: 'Subscription created',
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      customerId: customer.id,
    });

    const id = randomUUID();
    try {
      await this.repo.insert(
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
      );
    } catch (err) {
      // Prevent orphaned Stripe subscription when local insert fails
      this.stripeService.subscriptions.cancel(stripeSub.id).catch((cleanupErr: Error) =>
        this.logger.error({
          message: 'Failed to clean up orphaned Stripe subscription',
          stripeSubscriptionId: stripeSub.id,
          error: cleanupErr.message,
        }),
      );
      throw err;
    }

    return this.findById(id);
  }

  async findById(id: string): Promise<StripeSubscription> {
    const sub = await this.repo.findById(id);
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);

    const customer = await this.repo.findCustomerById(sub.customerId);
    if (customer) sub.customer = customer;

    return sub;
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<StripeSubscription | null> {
    return this.repo.findByStripeId(stripeSubscriptionId);
  }

  async listByCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: StripeSubscription[]; total: number; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const { data, total } = await this.repo.listByCustomer(customerId, offset, limit);
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

    await this.repo.update(
      id,
      dto.priceId ?? sub.stripePriceId,
      dto.paymentMethodId ?? sub.defaultPaymentMethodId ?? null,
      dto.cancelAtPeriodEnd !== undefined ? (dto.cancelAtPeriodEnd ? 1 : 0) : sub.cancelAtPeriodEnd ? 1 : 0,
      updated.status,
    );

    return this.findById(id);
  }

  async cancel(id: string): Promise<StripeSubscription> {
    const sub = await this.findById(id);
    const cancelled = await this.stripeService.subscriptions.cancel(
      sub.stripeSubscriptionId,
    );

    await this.repo.updateCancel(id, cancelled.status, cancelled.cancel_at_period_end ? 1 : 0);

    return this.findById(id);
  }

  async syncFromStripeEvent(stripeSub: Stripe.Subscription): Promise<void> {
    const sub = await this.repo.findByStripeId(stripeSub.id);

    if (sub) {
      await this.repo.syncUpdate(
        sub.id,
        stripeSub.status,
        new Date(stripeSub.current_period_start * 1000),
        new Date(stripeSub.current_period_end * 1000),
        stripeSub.cancel_at_period_end ? 1 : 0,
        stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : sub.trialStart ?? null,
        stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : sub.trialEnd ?? null,
        (stripeSub.default_payment_method as string) ?? sub.defaultPaymentMethodId ?? null,
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
      await this.repo.insertFromStripeEvent(
        id,
        stripeSub.id,
        stripeSub.status,
        new Date(stripeSub.current_period_start * 1000),
        new Date(stripeSub.current_period_end * 1000),
        stripeSub.cancel_at_period_end ? 1 : 0,
        stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : null,
        stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
        priceId,
        (stripeSub.default_payment_method as string) ?? null,
        customer.id,
      );
    } catch {
      return;
    }
  }

  /** Set subscription status — used by webhook handlers for immediate status updates. */
  async setStatus(id: string, status: string): Promise<void> {
    await this.repo.syncUpdateStatus(id, status);
  }

  async listPlans(activeOnly = true): Promise<SubscriptionPlan[]> {
    const cacheKey = CacheKeys.plans(activeOnly);
    const cached = await this.redis.get<SubscriptionPlan[]>(cacheKey);
    if (cached) return cached;

    const plans = await this.repo.listPlans(activeOnly);

    await this.redis.set(cacheKey, plans, CacheTtl.PLANS);
    return plans;
  }
}
