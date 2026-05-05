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
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';
import { StripeCustomer } from '../entities/stripe-customer.entity';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  create(
    @Body() dto: CreateCustomerDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.customersService.create(dto, idempotencyKey, user.id);
  }

  /** Returns the customer record for the currently authenticated user. */
  @Get('me')
  async getMe(@CurrentUser() user: JwtUser) {
    const customer = await this.customersService.findByUserId(user.id);
    if (!customer) throw new NotFoundException('No customer record found for this account');
    return customer;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.assertOwnership(id, user.id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertOwnership(id, user.id);
    return this.customersService.update(id, dto, idempotencyKey);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertOwnership(id, user.id);
    return this.customersService.softDelete(id);
  }

  @Post(':id/customer-sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertOwnership(id, user.id);
    return this.customersService.createCustomerSession(id);
  }

  @Post(':id/sync')
  async syncFromStripe(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const customer = await this.assertOwnership(id, user.id);
    return this.customersService.syncFromStripe(customer.stripeCustomerId);
  }

  private async assertOwnership(customerId: string, userId: string): Promise<StripeCustomer> {
    const customer = await this.customersService.findById(customerId);
    if (customer.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return customer;
  }
}
