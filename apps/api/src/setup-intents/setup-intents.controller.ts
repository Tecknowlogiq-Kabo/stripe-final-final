import {
  Controller,
  Get,
  Post,
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
import { SetupIntentsService } from './setup-intents.service';
import { CreateSetupIntentDto } from './dto/create-setup-intent.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';
import { CustomersService } from '../customers/customers.service';
import { StripeSetupIntent } from '../entities/stripe-setup-intent.entity';
import { Audit } from '../audit/audit.decorator';

function toPublicSetupIntent(si: StripeSetupIntent) {
  return {
    id: si.id,
    stripeSetupIntentId: si.stripeSetupIntentId,
    status: si.status,
    stripePaymentMethodId: si.stripePaymentMethodId ?? undefined,
    description: si.description ?? undefined,
    paymentMethodTypes: si.paymentMethodTypes ?? undefined,
    usage: si.usage ?? undefined,
    lastSetupError: si.lastSetupError ?? undefined,
    nextAction: si.nextAction ?? undefined,
    livemode: si.livemode,
    createdAt: si.createdAt,
    updatedAt: si.updatedAt,
  };
}

@Controller('setup-intents')
export class SetupIntentsController {
  constructor(
    private readonly service: SetupIntentsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ payment: { limit: 20, ttl: 60_000 } })
  @Audit({ action: 'setup-intent.create', resourceType: 'setup-intent', resourceIdPath: 'id' })
  async create(
    @Body() dto: CreateSetupIntentDto,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertCustomerOwnership(dto.customerId, user.id);
    return this.service.create(dto, idempotencyKey);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtUser) {
    const setupIntent = await this.service.findById(id);
    await this.assertCustomerOwnership(setupIntent.customerId, user.id);
    return toPublicSetupIntent(setupIntent);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtUser) {
    const setupIntent = await this.service.findById(id);
    await this.assertCustomerOwnership(setupIntent.customerId, user.id);
    return toPublicSetupIntent(await this.service.cancel(id));
  }

  private async assertCustomerOwnership(customerId: string, userId: string): Promise<void> {
    const customer = await this.customersService.findById(customerId);
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    if (customer.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
  }
}
