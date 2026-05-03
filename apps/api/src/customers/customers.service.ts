import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripeService } from '../stripe/stripe.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    @InjectRepository(StripeCustomer)
    private readonly customerRepo: Repository<StripeCustomer>,
    private readonly stripeService: StripeService,
  ) {}

  async create(
    dto: CreateCustomerDto,
    idempotencyKey: string,
  ): Promise<StripeCustomer> {
    // DB-level idempotency: return existing record for this key
    const existing = await this.customerRepo.findOne({
      where: { idempotencyKey },
    });
    if (existing) {
      this.logger.log({ message: 'Returning cached customer', idempotencyKey });
      return existing;
    }

    // Check for duplicate email (soft-deleted are excluded)
    const emailExists = await this.customerRepo.findOne({
      where: { email: dto.email, isDeleted: false },
    });
    if (emailExists) {
      throw new ConflictException(`Customer with email ${dto.email} already exists`);
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
      email: dto.email,
    });

    const customer = this.customerRepo.create({
      stripeCustomerId: stripeCustomer.id,
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      metadata: dto.metadata ? JSON.stringify(dto.metadata) : undefined,
      idempotencyKey,
    });

    return this.customerRepo.save(customer);
  }

  async findById(id: string): Promise<StripeCustomer> {
    const customer = await this.customerRepo.findOne({
      where: { id, isDeleted: false },
      relations: ['paymentMethods', 'subscriptions'],
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  async findByStripeId(stripeCustomerId: string): Promise<StripeCustomer> {
    const customer = await this.customerRepo.findOne({
      where: { stripeCustomerId, isDeleted: false },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with Stripe ID ${stripeCustomerId} not found`);
    }
    return customer;
  }

  async findByEmail(email: string): Promise<StripeCustomer | null> {
    return this.customerRepo.findOne({
      where: { email, isDeleted: false },
    });
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

    if (dto.email) customer.email = dto.email;
    if (dto.name !== undefined) customer.name = dto.name;
    if (dto.phone !== undefined) customer.phone = dto.phone;
    if (dto.metadata) customer.metadata = JSON.stringify(dto.metadata);

    return this.customerRepo.save(customer);
  }

  async softDelete(id: string): Promise<void> {
    const customer = await this.findById(id);
    // Archive in Stripe (soft delete)
    await this.stripeService.customers.del(customer.stripeCustomerId);
    customer.isDeleted = true;
    await this.customerRepo.save(customer);
    this.logger.log({ message: 'Customer soft deleted', customerId: id });
  }

  async createCustomerSession(customerId: string): Promise<{ clientSecret: string }> {
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
    const stripeCustomer = await this.stripeService.customers.retrieve(stripeCustomerId);
    if (stripeCustomer.deleted) {
      throw new NotFoundException('Stripe customer has been deleted');
    }
    const customer = await this.findByStripeId(stripeCustomerId);
    customer.email = stripeCustomer.email ?? customer.email;
    customer.name = stripeCustomer.name ?? undefined;
    customer.phone = stripeCustomer.phone ?? undefined;
    return this.customerRepo.save(customer);
  }
}
