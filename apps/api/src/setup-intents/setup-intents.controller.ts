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
} from '@nestjs/common';
import { SetupIntentsService } from './setup-intents.service';
import { CreateSetupIntentDto } from './dto/create-setup-intent.dto';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';

@Controller('setup-intents')
export class SetupIntentsController {
  constructor(private readonly service: SetupIntentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateSetupIntentDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.create(dto, idempotencyKey);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(id);
  }
}
