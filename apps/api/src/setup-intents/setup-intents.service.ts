import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreateSetupIntentDto } from './dto/create-setup-intent.dto';
import { SetupIntentsRepository } from './setup-intents.repository';

@Injectable()
export class SetupIntentsService {
  private readonly logger = new Logger(SetupIntentsService.name);

  constructor(
    private readonly repo: SetupIntentsRepository,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreateSetupIntentDto,
    idempotencyKey: string,
  ): Promise<{ id: string; clientSecret: string; stripeSetupIntentId: string; status: string }> {
    const existing = await this.repo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        id: existing.id,
        clientSecret: existing.clientSecret,
        stripeSetupIntentId: existing.stripeSetupIntentId,
        status: existing.status,
      };
    }

    const customer = await this.customersService.findById(dto.customerId);

    const stripeSI = await this.stripeService.setupIntents.create(
      {
        customer: customer.stripeCustomerId,
        ...(dto.paymentMethodTypes?.length
          ? { payment_method_types: dto.paymentMethodTypes }
          : { automatic_payment_methods: { enabled: true } }),
        usage: dto.usage ?? 'off_session',
        metadata: {
          ...dto.metadata,
          internal_customer_id: customer.id,
        },
        description: dto.description,
      },
      { idempotencyKey },
    );

    this.logger.log({
      message: 'SetupIntent created',
      stripeSetupIntentId: stripeSI.id,
      customerId: customer.id,
    });

    const clientSecret = stripeSI.client_secret;
    if (!clientSecret) {
      throw new Error(`SetupIntent ${stripeSI.id} missing client_secret`);
    }

    const id = randomUUID();
    const saved = await this.repo.insert(
      id,
      stripeSI.id,
      stripeSI.status,
      clientSecret,
      customer.id,
      idempotencyKey,
      dto.metadata ? JSON.stringify(dto.metadata) : null,
      dto.description ?? null,
      dto.usage ?? 'off_session',
      stripeSI.payment_method_types
        ? JSON.stringify(stripeSI.payment_method_types)
        : null,
      stripeSI.next_action
        ? JSON.stringify(stripeSI.next_action)
        : null,
      stripeSI.livemode ? 1 : 0,
    );

    return {
      id: saved.id,
      clientSecret: saved.clientSecret,
      stripeSetupIntentId: saved.stripeSetupIntentId,
      status: saved.status,
    };
  }

  async findById(id: string): Promise<StripeSetupIntent> {
    const si = await this.repo.findById(id);
    if (!si) throw new NotFoundException(`SetupIntent ${id} not found`);

    const customer = await this.repo.findCustomerById(si.customerId);
    if (customer) si.customer = customer;

    return si;
  }

  async findByStripeId(stripeSetupIntentId: string): Promise<StripeSetupIntent | null> {
    return this.repo.findByStripeId(stripeSetupIntentId);
  }

  async cancel(id: string): Promise<StripeSetupIntent> {
    const si = await this.findById(id);
    const cancelled = await this.stripeService.setupIntents.cancel(
      si.stripeSetupIntentId,
    );

    await this.repo.updateStatusById(id, cancelled.status);

    return this.findById(id);
  }

  async updateStatus(
    stripeSetupIntentId: string,
    status: string,
    stripePaymentMethodId?: string,
    lastSetupError?: string,
  ): Promise<void> {
    const si = await this.findByStripeId(stripeSetupIntentId);
    if (!si) return;

    await this.repo.updateStatus(
      si.id,
      status,
      stripePaymentMethodId ?? si.stripePaymentMethodId ?? null,
      lastSetupError ?? si.lastSetupError ?? null,
    );
  }
}
