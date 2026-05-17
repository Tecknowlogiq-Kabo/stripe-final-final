import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripeService } from '../stripe/stripe.service';
import { RedisService, CacheKeys, CacheTtl } from '../redis/redis.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomersRepository } from './customers.repository';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly repo: CustomersRepository,
    private readonly stripeService: StripeService,
    private readonly redis: RedisService,
  ) {}

  async create(
    dto: CreateCustomerDto,
    idempotencyKey: string,
    userId: string,
  ): Promise<StripeCustomer> {
    const existing = await this.repo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.logger.log({ message: 'Returning cached customer', idempotencyKey });
      return existing;
    }

    const emailExists = await this.repo.findActiveByEmail(dto.email);
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
    try {
      await this.repo.insert(
        id,
        stripeCustomer.id,
        dto.email,
        dto.name ?? null,
        dto.phone ?? null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
        idempotencyKey,
        userId,
      );
    } catch (err) {
      // Prevent orphaned Stripe customer when local insert fails
      this.stripeService.customers.del(stripeCustomer.id).catch((cleanupErr: Error) =>
        this.logger.error({
          message: 'Failed to clean up orphaned Stripe customer',
          stripeCustomerId: stripeCustomer.id,
          error: cleanupErr.message,
        }),
      );
      throw err;
    }

    return this.findById(id);
  }

  async findByUserId(userId: string): Promise<StripeCustomer | null> {
    const customer = await this.repo.findByUserId(userId);
    if (!customer) return null;
    return this.findById(customer.id);
  }

  async findById(id: string): Promise<StripeCustomer> {
    const cached = await this.redis.get<StripeCustomer>(CacheKeys.customer(id));
    if (cached) return cached;

    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    const paymentMethods = await this.repo.findPaymentMethodsByCustomer(id);
    const subscriptions = await this.repo.findSubscriptionsByCustomer(id);

    customer.paymentMethods = paymentMethods;
    customer.subscriptions = subscriptions;

    await this.redis.set(CacheKeys.customer(id), customer, CacheTtl.CUSTOMER);
    return customer;
  }

  async findByStripeId(stripeCustomerId: string): Promise<StripeCustomer> {
    const cached = await this.redis.get<StripeCustomer>(CacheKeys.customerByStripe(stripeCustomerId));
    if (cached) return cached;

    const row = await this.repo.findByStripeId(stripeCustomerId);
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
    return this.repo.findActiveByEmail(email);
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

    await this.repo.update(
      id,
      dto.email ?? customer.email,
      dto.name !== undefined ? (dto.name ?? null) : (customer.name ?? null),
      dto.phone !== undefined ? (dto.phone ?? null) : (customer.phone ?? null),
      dto.metadata ? JSON.stringify(dto.metadata) : (customer.metadata ?? null),
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
    await this.repo.softDelete(id);
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

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const customer = await this.findById(customerId);
    const session = await this.stripeService.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async syncFromStripe(stripeCustomerId: string): Promise<StripeCustomer> {
    const stripeCustomer = await this.stripeService.customers.retrieve(
      stripeCustomerId,
    );
    if (stripeCustomer.deleted) {
      throw new NotFoundException('Stripe customer has been deleted');
    }
    const customer = await this.findByStripeId(stripeCustomerId);

    await this.repo.syncUpdate(
      customer.id,
      stripeCustomer.email ?? customer.email,
      stripeCustomer.name ?? customer.name ?? null,
      stripeCustomer.phone ?? customer.phone ?? null,
    );

    await this.redis.del(
      CacheKeys.customer(customer.id),
      CacheKeys.customerByStripe(stripeCustomerId),
    );
    return this.findById(customer.id);
  }
}
