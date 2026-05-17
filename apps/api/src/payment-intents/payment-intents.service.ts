import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';
import { ListPaymentIntentsDto } from './dto/list-payment-intents.dto';
import { PaymentIntentsRepository } from './payment-intents.repository';

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    private readonly repo: PaymentIntentsRepository,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreatePaymentIntentDto,
    idempotencyKey: string,
  ): Promise<{ id: string; clientSecret: string; stripePaymentIntentId: string; status: string }> {
    const existing = await this.repo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.logger.log({ message: 'Returning cached payment intent', idempotencyKey });
      return {
        id: existing.id,
        clientSecret: existing.clientSecret,
        stripePaymentIntentId: existing.stripePaymentIntentId,
        status: existing.status,
      };
    }

    let stripeCustomerId: string | undefined;
    let internalCustomerId: string | undefined;

    if (dto.customerId) {
      const customer = await this.customersService.findById(dto.customerId);
      stripeCustomerId = customer.stripeCustomerId;
      internalCustomerId = customer.id;
    }

    const paymentMethodConfig = dto.paymentMethodTypes?.length
      ? { payment_method_types: dto.paymentMethodTypes }
      : { automatic_payment_methods: { enabled: true } };

    const stripePI = await this.stripeService.paymentIntents.create(
      {
        amount: dto.amount,
        currency: dto.currency.toLowerCase(),
        customer: stripeCustomerId,
        payment_method: dto.paymentMethodId,
        setup_future_usage: dto.setupFutureUsage,
        receipt_email: dto.receiptEmail,
        statement_descriptor: dto.statementDescriptor,
        ...paymentMethodConfig,
        metadata: { ...dto.metadata, ...(internalCustomerId ? { internal_customer_id: internalCustomerId } : {}) },
        description: dto.description,
      },
      { idempotencyKey },
    );

    this.logger.log({
      message: 'PaymentIntent created',
      stripePaymentIntentId: stripePI.id,
      amount: stripePI.amount,
      currency: stripePI.currency,
      customerId: internalCustomerId ?? 'guest',
    });

    const clientSecret = stripePI.client_secret;
    if (!clientSecret) {
      throw new Error(`PaymentIntent ${stripePI.id} missing client_secret`);
    }

    const id = randomUUID();
    const saved = await this.repo.insert(
      id,
      stripePI.id,
      stripePI.amount,
      stripePI.currency,
      stripePI.status,
      clientSecret,
      internalCustomerId ?? null,
      dto.paymentMethodId ?? null,
      idempotencyKey,
      dto.metadata ? JSON.stringify(dto.metadata) : null,
      dto.description ?? null,
      dto.setupFutureUsage ?? null,
      stripePI.payment_method_types
        ? JSON.stringify(stripePI.payment_method_types)
        : null,
      stripePI.amount_received ?? null,
      stripePI.amount_capturable ?? null,
      stripePI.next_action
        ? JSON.stringify(stripePI.next_action)
        : null,
      stripePI.livemode ? 1 : 0,
    );

    return {
      id: saved.id,
      clientSecret: saved.clientSecret,
      stripePaymentIntentId: saved.stripePaymentIntentId,
      status: saved.status,
    };
  }

  async findById(id: string): Promise<StripePaymentIntent> {
    const pi = await this.repo.findById(id);
    if (!pi) throw new NotFoundException(`PaymentIntent ${id} not found`);

    const customer = await this.repo.findCustomerById(pi.customerId);
    if (customer) pi.customer = customer;

    return pi;
  }

  async findByStripeId(stripePaymentIntentId: string): Promise<StripePaymentIntent | null> {
    return this.repo.findByStripeId(stripePaymentIntentId);
  }

  async findByCustomer(
    customerId: string,
    dto: ListPaymentIntentsDto,
  ): Promise<{ data: StripePaymentIntent[]; total: number; page: number; limit: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const { data, total } = await this.repo.findByCustomer(customerId, {
      status: dto.status,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      sortBy: dto.sortBy,
      sortOrder: dto.sortOrder,
      offset: dto.offset,
      limit,
    });

    return { data, total, page, limit };
  }

  async update(
    id: string,
    dto: UpdatePaymentIntentDto,
    idempotencyKey: string,
  ): Promise<StripePaymentIntent> {
    const pi = await this.findById(id);

    await this.stripeService.paymentIntents.update(
      pi.stripePaymentIntentId,
      { metadata: dto.metadata, description: dto.description },
      { idempotencyKey },
    );

    await this.repo.updateMetadata(
      id,
      dto.metadata ? JSON.stringify(dto.metadata) : pi.metadata ?? null,
      dto.description ?? pi.description ?? null,
    );

    return this.findById(id);
  }

  async cancel(id: string): Promise<StripePaymentIntent> {
    const pi = await this.findById(id);
    const cancelled = await this.stripeService.paymentIntents.cancel(
      pi.stripePaymentIntentId,
    );

    await this.repo.updateStatus(
      id,
      cancelled.status,
      pi.errorCode ?? null,
      pi.errorDeclineCode ?? null,
      pi.errorMessage ?? null,
      pi.nextAction ?? null,
      pi.amountReceived ?? null,
    );

    return this.findById(id);
  }

  async updateStatus(
    stripePaymentIntentId: string,
    status: string,
    errorCode?: string,
    errorDeclineCode?: string,
    errorMessage?: string,
    nextAction?: string,
    amountReceived?: number,
  ): Promise<void> {
    const pi = await this.findByStripeId(stripePaymentIntentId);
    if (!pi) return;

    await this.repo.updateStatus(
      pi.id,
      status,
      errorCode ?? pi.errorCode ?? null,
      errorDeclineCode ?? pi.errorDeclineCode ?? null,
      errorMessage ?? pi.errorMessage ?? null,
      nextAction !== undefined ? nextAction : pi.nextAction ?? null,
      amountReceived !== undefined ? amountReceived : pi.amountReceived ?? null,
    );
  }
}
