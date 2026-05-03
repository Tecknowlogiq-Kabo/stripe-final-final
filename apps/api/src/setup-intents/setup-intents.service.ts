import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreateSetupIntentDto } from './dto/create-setup-intent.dto';

@Injectable()
export class SetupIntentsService {
  private readonly logger = new Logger(SetupIntentsService.name);

  constructor(
    @InjectRepository(StripeSetupIntent)
    private readonly siRepo: Repository<StripeSetupIntent>,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreateSetupIntentDto,
    idempotencyKey: string,
  ): Promise<{ id: string; clientSecret: string; stripeSetupIntentId: string; status: string }> {
    const existing = await this.siRepo.findOne({ where: { idempotencyKey } });
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
        payment_method_types: dto.paymentMethodTypes ?? ['card'],
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

    const si = this.siRepo.create({
      stripeSetupIntentId: stripeSI.id,
      status: stripeSI.status,
      clientSecret: stripeSI.client_secret!,
      customer,
      idempotencyKey,
      metadata: dto.metadata ? JSON.stringify(dto.metadata) : undefined,
      description: dto.description,
    });

    const saved = await this.siRepo.save(si);
    return {
      id: saved.id,
      clientSecret: saved.clientSecret,
      stripeSetupIntentId: saved.stripeSetupIntentId,
      status: saved.status,
    };
  }

  async findById(id: string): Promise<StripeSetupIntent> {
    const si = await this.siRepo.findOne({
      where: { id },
      relations: ['customer'],
    });
    if (!si) throw new NotFoundException(`SetupIntent ${id} not found`);
    return si;
  }

  async findByStripeId(stripeSetupIntentId: string): Promise<StripeSetupIntent | null> {
    return this.siRepo.findOne({ where: { stripeSetupIntentId } });
  }

  async cancel(id: string): Promise<StripeSetupIntent> {
    const si = await this.findById(id);
    const cancelled = await this.stripeService.setupIntents.cancel(si.stripeSetupIntentId);
    si.status = cancelled.status;
    return this.siRepo.save(si);
  }

  async updateStatus(stripeSetupIntentId: string, status: string, stripePaymentMethodId?: string): Promise<void> {
    const si = await this.findByStripeId(stripeSetupIntentId);
    if (!si) return;
    si.status = status;
    if (stripePaymentMethodId) si.stripePaymentMethodId = stripePaymentMethodId;
    await this.siRepo.save(si);
  }
}
