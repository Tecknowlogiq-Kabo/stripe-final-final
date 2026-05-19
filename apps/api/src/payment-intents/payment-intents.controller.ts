import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentIntentsService } from './payment-intents.service';
import { CustomersService } from '../customers/customers.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';
import { ListPaymentIntentsDto } from './dto/list-payment-intents.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../audit/audit.decorator';
import { StripePaymentIntent } from '../entities/stripe-payment-intent.entity';

function toPublicPaymentIntent(pi: StripePaymentIntent) {
  return {
    id: pi.id,
    stripePaymentIntentId: pi.stripePaymentIntentId,
    amount: pi.amount,
    currency: pi.currency,
    status: pi.status,
    description: pi.description ?? undefined,
    amountReceived: pi.amountReceived ?? undefined,
    receiptEmail: pi.receiptEmail ?? undefined,
    statementDescriptor: pi.statementDescriptor ?? undefined,
    createdAt: pi.createdAt,
    updatedAt: pi.updatedAt,
  };
}

@Controller('payment-intents')
export class PaymentIntentsController {
  constructor(
    private readonly service: PaymentIntentsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  @Audit({ action: 'payment.create', resourceType: 'payment-intent', resourceIdPath: 'id' })
  async create(
    @Body() dto: CreatePaymentIntentDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.create(dto, idempotencyKey, user.id, user.email);
  }

  @Get('mine')
  async findMine(
    @Query() dto: ListPaymentIntentsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const customer = await this.customersService.findByUserId(user.id);
    if (!customer) {
      return { data: [], total: 0, page: dto.page ?? 1, limit: dto.limit ?? 20 };
    }
    const response = await this.service.findByCustomer(customer.id, dto);
    return {
      ...response,
      data: response.data.map(toPublicPaymentIntent),
    };
  }

  @Get('stripe/:stripeId')
  async findByStripeId(
    @Param('stripeId') stripeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findByStripeId(stripeId);
    if (!pi) throw new NotFoundException(`PaymentIntent ${stripeId} not found`);
    await this.assertPaymentIntentOwnership(pi, user.id);
    return {
      id: pi.id,
      status: pi.status,
      errorMessage: pi.errorMessage ?? undefined,
    };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findById(id);
    await this.assertPaymentIntentOwnership(pi, user.id);
    return toPublicPaymentIntent(pi);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentIntentDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findById(id);
    await this.assertPaymentIntentOwnership(pi, user.id);
    return toPublicPaymentIntent(await this.service.update(id, dto, idempotencyKey));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findById(id);
    await this.assertPaymentIntentOwnership(pi, user.id);
    return toPublicPaymentIntent(await this.service.cancel(id));
  }

  /** Verify that the authenticated user owns the payment intent's customer. */
  private async assertPaymentIntentOwnership(pi: StripePaymentIntent, userId: string): Promise<void> {
    if (!pi.customerId) throw new ForbiddenException('Access denied');
    const customer = await this.customersService.findById(pi.customerId);
    if (!customer) throw new NotFoundException(`Customer not found`);
    if (customer.userId !== userId) throw new ForbiddenException('Access denied');
  }
}