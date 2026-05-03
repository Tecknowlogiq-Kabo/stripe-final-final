import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    @InjectRepository(StripePaymentIntent)
    private readonly piRepo: Repository<StripePaymentIntent>,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreatePaymentIntentDto,
    idempotencyKey: string,
  ): Promise<{ id: string; clientSecret: string; stripePaymentIntentId: string; status: string }> {
    // DB-level idempotency
    const existing = await this.piRepo.findOne({ where: { idempotencyKey } });
    if (existing) {
      this.logger.log({ message: 'Returning cached payment intent', idempotencyKey });
      return {
        id: existing.id,
        clientSecret: existing.clientSecret,
        stripePaymentIntentId: existing.stripePaymentIntentId,
        status: existing.status,
      };
    }

    const customer = await this.customersService.findById(dto.customerId);

    const stripePI = await this.stripeService.paymentIntents.create(
      {
        amount: dto.amount,
        currency: dto.currency.toLowerCase(),
        customer: customer.stripeCustomerId,
        payment_method: dto.paymentMethodId,
        setup_future_usage: dto.setupFutureUsage,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          ...dto.metadata,
          internal_customer_id: customer.id,
        },
        description: dto.description,
      },
      { idempotencyKey },
    );

    this.logger.log({
      message: 'PaymentIntent created',
      stripePaymentIntentId: stripePI.id,
      amount: stripePI.amount,
      currency: stripePI.currency,
      customerId: customer.id,
    });

    const pi = this.piRepo.create({
      stripePaymentIntentId: stripePI.id,
      amount: stripePI.amount,
      currency: stripePI.currency,
      status: stripePI.status,
      clientSecret: stripePI.client_secret!,
      customer,
      stripePaymentMethodId: dto.paymentMethodId,
      idempotencyKey,
      metadata: dto.metadata ? JSON.stringify(dto.metadata) : undefined,
      description: dto.description,
    });

    const saved = await this.piRepo.save(pi);

    return {
      id: saved.id,
      clientSecret: saved.clientSecret,
      stripePaymentIntentId: saved.stripePaymentIntentId,
      status: saved.status,
    };
  }

  async findById(id: string): Promise<StripePaymentIntent> {
    const pi = await this.piRepo.findOne({
      where: { id },
      relations: ['customer'],
    });
    if (!pi) throw new NotFoundException(`PaymentIntent ${id} not found`);
    return pi;
  }

  async findByStripeId(stripePaymentIntentId: string): Promise<StripePaymentIntent | null> {
    return this.piRepo.findOne({ where: { stripePaymentIntentId } });
  }

  async update(
    id: string,
    dto: UpdatePaymentIntentDto,
    idempotencyKey: string,
  ): Promise<StripePaymentIntent> {
    const pi = await this.findById(id);

    await this.stripeService.paymentIntents.update(
      pi.stripePaymentIntentId,
      {
        metadata: dto.metadata,
        description: dto.description,
      },
      { idempotencyKey },
    );

    if (dto.metadata) pi.metadata = JSON.stringify(dto.metadata);
    if (dto.description) pi.description = dto.description;
    return this.piRepo.save(pi);
  }

  async cancel(id: string): Promise<StripePaymentIntent> {
    const pi = await this.findById(id);
    const cancelled = await this.stripeService.paymentIntents.cancel(
      pi.stripePaymentIntentId,
    );
    pi.status = cancelled.status;
    return this.piRepo.save(pi);
  }

  async updateStatus(
    stripePaymentIntentId: string,
    status: string,
    errorCode?: string,
    errorDeclineCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    const pi = await this.findByStripeId(stripePaymentIntentId);
    if (!pi) return;
    pi.status = status;
    if (errorCode) pi.errorCode = errorCode;
    if (errorDeclineCode) pi.errorDeclineCode = errorDeclineCode;
    if (errorMessage) pi.errorMessage = errorMessage;
    await this.piRepo.save(pi);
  }
}
