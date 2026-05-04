import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { Throttle } from '@nestjs/throttler';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Get('plans')
  listPlans(@Query('active') active?: string) {
    return this.service.listPlans(active !== 'false');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  create(
    @Body() dto: CreateSubscriptionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.create(dto, idempotencyKey);
  }

  @Get('customer/:customerId')
  listByCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.service.listByCustomer(customerId, pagination.page, pagination.limit);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
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
