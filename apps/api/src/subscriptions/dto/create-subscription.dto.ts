import {
  IsUUID,
  IsString,
  IsOptional,
  IsInt,
  Min,
  IsObject,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  customerId: string;

  @IsString()
  priceId: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  trialPeriodDays?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
