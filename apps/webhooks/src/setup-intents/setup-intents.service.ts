import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
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

    let stripeSI;
    try {
      stripeSI = await this.stripeService.setupIntents.create(
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
    } catch (stripeError) {
      this.logger.error({
        message: 'Stripe SetupIntent creation failed',
        stripeError: stripeError instanceof Error ? stripeError.message : String(stripeError),
        idempotencyKey,
      });
      throw stripeError;
    }

    const clientSecret = stripeSI.client_secret;
    if (!clientSecret) {
      await this.stripeService.setupIntents.cancel(stripeSI.id);
      throw new InternalServerErrorException(
        `SetupIntent ${stripeSI.id} missing client_secret`,
      );
    }

    const id = randomUUID();
    try {
      await this.repo.insert(
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

      this.logger.log({
        message: 'SetupIntent created and saved',
        stripeSetupIntentId: stripeSI.id,
        customerId: customer.id,
      });

      return {
        id,
        clientSecret,
        stripeSetupIntentId: stripeSI.id,
        status: stripeSI.status,
      };
    } catch (dbError) {
      // Stripe resource exists but DB insert failed → cancel the Stripe SI to avoid orphans
      this.logger.error({
        message: 'DB insert failed after Stripe SI created — cancelling Stripe SI',
        stripeSetupIntentId: stripeSI.id,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });
      await this.stripeService.setupIntents.cancel(stripeSI.id);
      throw new InternalServerErrorException(
        'Failed to save setup intent — the intent has been voided. Please try again.',
      );
    }
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
