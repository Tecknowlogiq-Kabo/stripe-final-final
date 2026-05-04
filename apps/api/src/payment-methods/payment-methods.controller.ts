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
} from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Get('customer/:customerId')
  listByCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.service.listByCustomer(customerId, pagination.page, pagination.limit);
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
