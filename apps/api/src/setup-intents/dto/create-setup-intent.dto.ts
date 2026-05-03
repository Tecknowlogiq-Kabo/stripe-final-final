import {
  IsUUID,
  IsOptional,
  IsArray,
  IsString,
  IsObject,
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
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}
