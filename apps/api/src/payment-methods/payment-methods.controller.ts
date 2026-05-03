import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Get('customer/:customerId')
  listByCustomer(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.service.listByCustomer(customerId);
  }

  @Post(':id/set-default/customer/:customerId')
  @HttpCode(HttpStatus.OK)
  setDefault(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('id', ParseUUIDPipe) paymentMethodId: string,
  ) {
    return this.service.setDefault(customerId, paymentMethodId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  detach(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detach(id);
  }
}
