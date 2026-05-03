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
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Get('plans')
  listPlans(@Query('active') active?: string) {
    return this.service.listPlans(active !== 'false');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateSubscriptionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.create(dto, idempotencyKey);
  }

  @Get('customer/:customerId')
  listByCustomer(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.service.listByCustomer(customerId);
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
