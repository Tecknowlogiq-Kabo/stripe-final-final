import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeSubscription } from '../entities/stripe-subscription.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(StripeSubscription)
    private readonly subRepo: Repository<StripeSubscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreateSubscriptionDto,
    idempotencyKey: string,
  ): Promise<StripeSubscription> {
    const customer = await this.customersService.findById(dto.customerId);

    // Check for existing active subscription with same customer + price (prevent duplicates)
    const existingForCustomer = await this.subRepo.findOne({
      where: {
        customer: { id: dto.customerId },
        stripePriceId: dto.priceId,
        status: 'active',
      },
    });
    if (existingForCustomer) {
      this.logger.log({ message: 'Returning existing active subscription', customerId: dto.customerId });
      return existingForCustomer;
    }

    const createParams: Stripe.SubscriptionCreateParams = {
      customer: customer.stripeCustomerId,
      items: [{ price: dto.priceId }],
      metadata: {
        ...dto.metadata,
        internal_customer_id: customer.id,
      },
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

    // Handle network timeout retry: Stripe returned the same sub, already in DB
    const alreadySaved = await this.subRepo.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (alreadySaved) return alreadySaved;

    this.logger.log({
      message: 'Subscription created',
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      customerId: customer.id,
    });

    const sub = this.subRepo.create({
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
      currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      trialStart: stripeSub.trial_start
        ? new Date(stripeSub.trial_start * 1000)
        : undefined,
      trialEnd: stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000)
        : undefined,
      stripePriceId: dto.priceId,
      defaultPaymentMethodId: dto.paymentMethodId,
      customer,
      metadata: dto.metadata ? JSON.stringify(dto.metadata) : undefined,
    });

    return this.subRepo.save(sub);
  }

  async findById(id: string): Promise<StripeSubscription> {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['customer'],
    });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    return sub;
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<StripeSubscription | null> {
    return this.subRepo.findOne({ where: { stripeSubscriptionId } });
  }

  async listByCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: StripeSubscription[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.subRepo.findAndCount({
      where: { customer: { id: customerId } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
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
      // Retrieve current subscription to get item ID
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

    if (dto.priceId) sub.stripePriceId = dto.priceId;
    if (dto.paymentMethodId) sub.defaultPaymentMethodId = dto.paymentMethodId;
    if (dto.cancelAtPeriodEnd !== undefined) {
      sub.cancelAtPeriodEnd = dto.cancelAtPeriodEnd;
    }
    sub.status = updated.status;
    return this.subRepo.save(sub);
  }

  async cancel(id: string): Promise<StripeSubscription> {
    const sub = await this.findById(id);
    const cancelled = await this.stripeService.subscriptions.cancel(
      sub.stripeSubscriptionId,
    );
    sub.status = cancelled.status;
    sub.cancelAtPeriodEnd = cancelled.cancel_at_period_end;
    return this.subRepo.save(sub);
  }

  async syncFromStripeEvent(stripeSub: Stripe.Subscription): Promise<void> {
    let sub = await this.findByStripeId(stripeSub.id);

    if (!sub) {
      try {
        const customer = await this.customersService.findByStripeId(
          stripeSub.customer as string,
        );
        sub = this.subRepo.create({
          stripeSubscriptionId: stripeSub.id,
          customer,
          stripePriceId: stripeSub.items.data[0]?.price.id ?? '',
        });
      } catch {
        return; // customer not in our DB
      }
    }

    sub.status = stripeSub.status;
    sub.currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
    sub.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
    sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;
    if (stripeSub.trial_start) sub.trialStart = new Date(stripeSub.trial_start * 1000);
    if (stripeSub.trial_end) sub.trialEnd = new Date(stripeSub.trial_end * 1000);
    if (stripeSub.default_payment_method) {
      sub.defaultPaymentMethodId = stripeSub.default_payment_method as string;
    }

    await this.subRepo.save(sub);
    this.logger.log({
      message: 'Subscription synced from Stripe event',
      stripeSubscriptionId: stripeSub.id,
      status: stripeSub.status,
    });
  }

  async listPlans(activeOnly = true): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({
      where: activeOnly ? { isActive: true } : {},
      order: { amount: 'ASC' },
    });
  }
}
