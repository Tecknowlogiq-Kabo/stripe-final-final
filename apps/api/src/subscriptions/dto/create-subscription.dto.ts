import {
  IsUUID,
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsString()
  priceId?: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999) // Stripe maximum trial period
  trialPeriodDays?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
