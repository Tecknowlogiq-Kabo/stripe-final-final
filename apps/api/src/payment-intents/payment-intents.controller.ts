import { Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentIntentsService } from './payment-intents.service';
import { CustomersService } from '../customers/customers.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { UpdatePaymentIntentDto } from './dto/update-payment-intent.dto';
import { ListPaymentIntentsDto } from './dto/list-payment-intents.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payment-intents')
export class PaymentIntentsController {
  constructor(
    private readonly service: PaymentIntentsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  create(
    @Body() dto: CreatePaymentIntentDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.create(dto, idempotencyKey);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Get('stripe/:stripeId')
  @Public()
  async findByStripeId(@Param('stripeId') stripeId: string) {
    const pi = await this.service.findByStripeId(stripeId);
    if (!pi) throw new NotFoundException(`PaymentIntent ${stripeId} not found`);
    return pi;
  }

  @Get('customer/:customerId')
  async findByCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() dto: ListPaymentIntentsDto,
  ) {
    const customer = await this.customersService.findById(customerId);
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);
    return this.service.findByCustomer(customerId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentIntentDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.update(id, dto, idempotencyKey);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(id);
  }
}
