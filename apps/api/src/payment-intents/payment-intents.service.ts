import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { StripeService } from '../stripe/stripe.service';
import { CustomersService } from '../customers/customers.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';
import { ListPaymentIntentsDto } from './dto/list-payment-intents.dto';
import { PI_SELECT, CUSTOMER_SELECT } from '../database/query-constants';

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly customersService: CustomersService,
  ) {}

  async create(
    dto: CreatePaymentIntentDto,
    idempotencyKey: string,
  ): Promise<{ id: string; clientSecret: string; stripePaymentIntentId: string; status: string }> {
    const [existing] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE IDEMPOTENCY_KEY = :1 AND ROWNUM = 1`,
      [idempotencyKey],
    );
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

    const stripePI = await this.stripeService.paymentIntents.create(
      {
        amount: dto.amount,
        currency: dto.currency.toLowerCase(),
        customer: stripeCustomerId,
        payment_method: dto.paymentMethodId,
        setup_future_usage: dto.setupFutureUsage,
        receipt_email: dto.receiptEmail,
        statement_descriptor: dto.statementDescriptor,
        automatic_payment_methods: { enabled: true },
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
    await this.dataSource.query(
      `INSERT INTO STRIPE_PAYMENT_INTENTS (ID, STRIPE_PI_ID, AMOUNT, CURRENCY, STATUS, CLIENT_SECRET, CUSTOMER_ID, STRIPE_PM_ID, IDEMPOTENCY_KEY, METADATA, DESCRIPTION, SETUP_FUTURE_USAGE, PAYMENT_METHOD_TYPES, AMOUNT_RECEIVED, AMOUNT_CAPTURABLE, NEXT_ACTION, LIVEMODE, CREATED_AT, UPDATED_AT)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13, :14, :15, :16, :17, SYSDATE, SYSDATE)`,
      [
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
      ],
    );

    const [saved] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE ID = :1`,
      [id],
    );

    return {
      id: saved.id,
      clientSecret: saved.clientSecret,
      stripePaymentIntentId: saved.stripePaymentIntentId,
      status: saved.status,
    };
  }

  async findById(id: string): Promise<StripePaymentIntent> {
    const [pi] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE ID = :1`,
      [id],
    );
    if (!pi) throw new NotFoundException(`PaymentIntent ${id} not found`);

    const [customer] = await this.dataSource.query<StripeCustomer[]>(
      `SELECT ${CUSTOMER_SELECT} FROM STRIPE_CUSTOMERS WHERE ID = :1`,
      [pi.customerId],
    );
    if (customer) pi.customer = customer;

    return pi;
  }

  async findByStripeId(stripePaymentIntentId: string): Promise<StripePaymentIntent | null> {
    const [pi] = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE STRIPE_PI_ID = :1 AND ROWNUM = 1`,
      [stripePaymentIntentId],
    );
    return pi ?? null;
  }

  async findByCustomer(
    customerId: string,
    dto: ListPaymentIntentsDto,
  ): Promise<{ data: StripePaymentIntent[]; total: number; page: number; limit: number }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const { offset, status, dateFrom, dateTo, sortBy, sortOrder } = dto;

    const conditions = ['CUSTOMER_ID = :1'];
    const params: unknown[] = [customerId];
    let idx = 2;

    if (status) {
      conditions.push(`STATUS = :${idx}`);
      params.push(status);
      idx++;
    }

    if (dateFrom && dateTo) {
      conditions.push(`CREATED_AT BETWEEN :${idx} AND :${idx + 1}`);
      params.push(new Date(dateFrom), new Date(dateTo));
      idx += 2;
    } else if (dateFrom) {
      conditions.push(`CREATED_AT >= :${idx}`);
      params.push(new Date(dateFrom));
      idx++;
    } else if (dateTo) {
      conditions.push(`CREATED_AT <= :${idx}`);
      params.push(new Date(dateTo));
      idx++;
    }

    const whereClause = conditions.join(' AND ');
    const sortCol = sortBy === 'amount' ? 'AMOUNT' : 'CREATED_AT';

    const [countResult] = await this.dataSource.query<{ cnt: string }[]>(
      `SELECT COUNT(*) AS "cnt" FROM STRIPE_PAYMENT_INTENTS WHERE ${whereClause}`,
      [...params],
    );
    const total = Number(countResult.cnt);

    const offsetIdx = idx;
    const limitIdx = idx + 1;
    const data = await this.dataSource.query<StripePaymentIntent[]>(
      `SELECT ${PI_SELECT} FROM STRIPE_PAYMENT_INTENTS WHERE ${whereClause} ORDER BY ${sortCol} ${sortOrder} OFFSET :${offsetIdx} ROWS FETCH NEXT :${limitIdx} ROWS ONLY`,
      [...params, offset, limit],
    );

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

    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_INTENTS SET METADATA = :1, DESCRIPTION = :2, UPDATED_AT = SYSDATE WHERE ID = :3`,
      [
        dto.metadata ? JSON.stringify(dto.metadata) : pi.metadata ?? null,
        dto.description ?? pi.description ?? null,
        id,
      ],
    );

    return this.findById(id);
  }

  async cancel(id: string): Promise<StripePaymentIntent> {
    const pi = await this.findById(id);
    const cancelled = await this.stripeService.paymentIntents.cancel(
      pi.stripePaymentIntentId,
    );

    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_INTENTS SET STATUS = :1, UPDATED_AT = SYSDATE WHERE ID = :2`,
      [cancelled.status, id],
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

    await this.dataSource.query(
      `UPDATE STRIPE_PAYMENT_INTENTS SET STATUS = :1, ERROR_CODE = :2, ERROR_DECLINE_CODE = :3, ERROR_MESSAGE = :4, NEXT_ACTION = :5, AMOUNT_RECEIVED = :6, UPDATED_AT = SYSDATE WHERE ID = :7`,
      [
        status,
        errorCode ?? pi.errorCode ?? null,
        errorDeclineCode ?? pi.errorDeclineCode ?? null,
        errorMessage ?? pi.errorMessage ?? null,
        nextAction !== undefined ? nextAction : pi.nextAction ?? null,
        amountReceived !== undefined ? amountReceived : pi.amountReceived ?? null,
        pi.id,
      ],
    );
  }
}
