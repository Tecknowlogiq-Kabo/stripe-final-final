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
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CustomersService } from '../customers/customers.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { Throttle } from '@nestjs/throttler';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';
import { CacheKeys } from '../redis/redis.service';
import { RedisService } from '../redis/redis.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly service: SubscriptionsService,
    private readonly customersService: CustomersService,
    private readonly redis: RedisService,
  ) {}

  @Get('plans')
  listPlans(@Query('active') active?: string) {
    return this.service.listPlans(active !== 'false');
  }

  /** Force-refresh plan cache from DB (call after Stripe plan changes). */
  @Post('plans/sync')
  @HttpCode(HttpStatus.OK)
  async syncPlans() {
    await this.redis.del(CacheKeys.plans(true), CacheKeys.plans(false));
    const [active, all] = await Promise.all([
      this.service.listPlans(true),
      this.service.listPlans(false),
    ]);
    return { active: active.length, all: all.length };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  async create(
    @Body() dto: CreateSubscriptionDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertCustomerOwnership(dto.customerId, user.id);
    return this.service.create(dto, idempotencyKey);
  }

  @Get('customer/:customerId')
  async listByCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertCustomerOwnership(customerId, user.id);
    return this.service.listByCustomer(customerId, pagination.page, pagination.limit);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const sub = await this.service.findById(id);
    await this.assertCustomerOwnership(sub.customerId, user.id);
    return sub;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubscriptionDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    const sub = await this.service.findById(id);
    await this.assertCustomerOwnership(sub.customerId, user.id);
    return this.service.update(id, dto, idempotencyKey);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const sub = await this.service.findById(id);
    await this.assertCustomerOwnership(sub.customerId, user.id);
    return this.service.cancel(id);
  }

  private async assertCustomerOwnership(customerId: string, userId: string): Promise<void> {
    const customer = await this.customersService.findById(customerId);
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);
    if (customer.userId !== userId) throw new ForbiddenException('Access denied');
  }
}
