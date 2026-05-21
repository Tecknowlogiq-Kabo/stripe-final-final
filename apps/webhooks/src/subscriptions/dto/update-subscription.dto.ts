import {
  IsOptional,
  IsString,
  IsBoolean,
  IsObject,
} from 'class-validator';

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsString()
  priceId?: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
