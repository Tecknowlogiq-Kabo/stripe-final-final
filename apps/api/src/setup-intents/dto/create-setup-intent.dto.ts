import {
  IsUUID,
  IsOptional,
  IsArray,
  IsString,
  IsObject,
  IsIn,
  MaxLength,
} from 'class-validator';

export class CreateSetupIntentDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentMethodTypes?: string[];

  @IsOptional()
  @IsIn(['off_session', 'on_session'])
  usage?: 'off_session' | 'on_session';

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}
