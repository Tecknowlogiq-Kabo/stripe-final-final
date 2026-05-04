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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  create(
    @Body() dto: CreateCustomerDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.customersService.create(dto, idempotencyKey);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.customersService.update(id, dto, idempotencyKey);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.softDelete(id);
  }

  @Post(':id/customer-sessions')
  @HttpCode(HttpStatus.CREATED)
  createSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.createCustomerSession(id);
  }

  @Post(':id/sync')
  syncFromStripe(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findById(id).then((c) =>
      this.customersService.syncFromStripe(c.stripeCustomerId),
    );
  }
}
