import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreateSetupIntentDto } from './dto/create-setup-intent.dto';

const SI_SELECT = `ID AS "id", STRIPE_SI_ID AS "stripeSetupIntentId", STATUS AS "status", CLIENT_SECRET AS "clientSecret", CUSTOMER_ID AS "customerId", STRIPE_PM_ID AS "stripePaymentMethodId", IDEMPOTENCY_KEY AS "idempotencyKey", METADATA AS "metadata", DESCRIPTION AS "description", PAYMENT_METHOD_TYPES AS "paymentMethodTypes", USAGE AS "usage", LAST_SETUP_ERROR AS "lastSetupError", NEXT_ACTION AS "nextAction", LIVEMODE AS "livemode", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;
const CUSTOMER_SELECT = `ID AS "id", STRIPE_CUSTOMER_ID AS "stripeCustomerId", EMAIL AS "email", NAME AS "name", PHONE AS "phone", METADATA AS "metadata", IDEMPOTENCY_KEY AS "idempotencyKey", IS_DELETED AS "isDeleted", CREATED_AT AS "createdAt", UPDATED_AT AS "updatedAt"`;

@Injectable()
export class SetupIntentsService {
  private readonly logger = new Logger(SetupIntentsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreateSetupIntentDto,
    idempotencyKey: string,
  ): Promise<{ id: string; clientSecret: string; stripeSetupIntentId: string; status: string }> {
    const [existing] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE IDEMPOTENCY_KEY = :1 AND ROWNUM = 1`,
      [idempotencyKey],
    );
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

    const id = randomUUID();
    await this.dataSource.query(
      `INSERT INTO STRIPE_SETUP_INTENTS (ID, STRIPE_SI_ID, STATUS, CLIENT_SECRET, CUSTOMER_ID, IDEMPOTENCY_KEY, METADATA, DESCRIPTION, USAGE, PAYMENT_METHOD_TYPES, NEXT_ACTION, LIVEMODE, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, SYSDATE, SYSDATE)`,
      [
        id,
        stripeSI.id,
        stripeSI.status,
        stripeSI.client_secret!,
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
      ],
    );

    const [saved] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE ID = :1`,
      [id],
    );

    return {
      id: saved.id,
      clientSecret: saved.clientSecret,
      stripeSetupIntentId: saved.stripeSetupIntentId,
      status: saved.status,
    };
  }

  async findById(id: string): Promise<StripeSetupIntent> {
    const [si] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE ID = :1`,
      [id],
    );
    if (!si) throw new NotFoundException(`SetupIntent ${id} not found`);

    const [customer] = await this.dataSource.query<any[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1`,
      [(si as any).customerId],
    );
    (si as any).customer = customer ?? null;

    return si;
  }

  async findByStripeId(stripeSetupIntentId: string): Promise<StripeSetupIntent | null> {
    const [si] = await this.dataSource.query<StripeSetupIntent[]>(
      `SELECT ${SI_SELECT} FROM STRIPE_SETUP_INTENTS WHERE STRIPE_SI_ID = :1 AND ROWNUM = 1`,
      [stripeSetupIntentId],
    );
    return si ?? null;
  }

  async cancel(id: string): Promise<StripeSetupIntent> {
    const si = await this.findById(id);
    const cancelled = await this.stripeService.setupIntents.cancel(
      si.stripeSetupIntentId,
    );

    await this.dataSource.query(
      `UPDATE STRIPE_SETUP_INTENTS SET STATUS = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [cancelled.status, id],
    );

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

    await this.dataSource.query(
      `UPDATE STRIPE_SETUP_INTENTS SET STATUS = :1, STRIPE_PM_ID = :2, LAST_SETUP_ERROR = :3, UPDATED_AT = SYSDATE WHERE ID = :4`,
      [
        status,
        stripePaymentMethodId ?? (si as any).stripePaymentMethodId ?? null,
        lastSetupError ?? (si as any).lastSetupError ?? null,
        si.id,
      ],
    );
  }
}
