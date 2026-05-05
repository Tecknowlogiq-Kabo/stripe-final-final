import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Query,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { CustomersService } from '../customers/customers.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(
    private readonly service: PaymentMethodsService,
    private readonly customersService: CustomersService,
  ) {}

  @Get('customer/:customerId')
  async listByCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() pagination: PaginationDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertCustomerOwnership(customerId, user.id);
    return this.service.listByCustomer(customerId, pagination.page, pagination.limit);
  }

  @Post(':id/set-default/customer/:customerId')
  @HttpCode(HttpStatus.OK)
  async setDefault(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('id', ParseUUIDPipe) paymentMethodId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertCustomerOwnership(customerId, user.id);
    return this.service.setDefault(customerId, paymentMethodId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async detach(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    // Fetch PM to get customerId, then check ownership
    const pm = await this.service.findById(id);
    await this.assertCustomerOwnership(pm.customerId, user.id);
    return this.service.detach(id);
  }

  private async assertCustomerOwnership(customerId: string, userId: string): Promise<void> {
    const customer = await this.customersService.findById(customerId);
    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);
    if (customer.userId !== userId) throw new ForbiddenException('Access denied');
  }
}
