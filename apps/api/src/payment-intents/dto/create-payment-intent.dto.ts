import {
  IsInt,
  IsString,
  IsUUID,
  IsOptional,
  IsEnum,
  Min,
  MaxLength,
  IsObject,
} from 'class-validator';

export class CreatePaymentIntentDto {
  @IsInt()
  @Min(50) // Stripe minimum is 50 cents
  amount: number;

  @IsString()
  @MaxLength(3)
  currency: string;

  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsEnum(['on_session', 'off_session'])
  setupFutureUsage?: 'on_session' | 'off_session';

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}
