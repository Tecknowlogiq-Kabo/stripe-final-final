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
  async create(
    @Body() dto: CreatePaymentIntentDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (dto.customerId) {
      await this.assertCustomerOwnership(dto.customerId, user.id);
    }
    return this.service.create(dto, idempotencyKey);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findById(id);
    await this.assertCustomerOwnership(pi.customerId, user.id);
    return toPublicPaymentIntent(pi);
  }

  @Get('stripe/:stripeId')
  async findByStripeId(
    @Param('stripeId') stripeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findByStripeId(stripeId);
    if (!pi) throw new NotFoundException(`PaymentIntent ${stripeId} not found`);
    await this.assertCustomerOwnership(pi.customerId, user.id);
    return {
      id: pi.id,
      status: pi.status,
      errorMessage: pi.errorMessage ?? undefined,
    };
  }

  @Get('customer/:customerId')
  async findByCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() dto: ListPaymentIntentsDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertCustomerOwnership(customerId, user.id);
    const response = await this.service.findByCustomer(customerId, dto);
    return {
      ...response,
      data: response.data.map(toPublicPaymentIntent),
    };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentIntentDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findById(id);
    await this.assertCustomerOwnership(pi.customerId, user.id);
    return toPublicPaymentIntent(await this.service.update(id, dto, idempotencyKey));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const pi = await this.service.findById(id);
    await this.assertCustomerOwnership(pi.customerId, user.id);
    return toPublicPaymentIntent(await this.service.cancel(id));
  }

  private async assertCustomerOwnership(customerId: string, userId: string): Promise<void> {
    const customer = await this.customersService.findById(customerId);
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);
    if (customer.userId !== userId) throw new ForbiddenException('Access denied');
  }
}
