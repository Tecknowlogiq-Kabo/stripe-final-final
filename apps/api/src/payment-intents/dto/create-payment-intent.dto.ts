import {
  IsInt,
  IsString,
  IsEmail,
  IsUUID,
  IsOptional,
  IsEnum,
  IsArray,
  Min,
  Max,
  MaxLength,
  IsObject,
  Matches,
} from 'class-validator';

export class CreatePaymentIntentDto {
  @IsInt()
  @Min(50) // Stripe minimum is 50 cents
  @Max(99999999) // ~$999,999.99 — prevents overflow and aligns with Stripe limits
  amount: number;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code (e.g. usd)' })
  currency: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsEnum(['on_session', 'off_session'])
  setupFutureUsage?: 'on_session' | 'off_session';

  @IsOptional()
  @IsEmail()
  receiptEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(22) // Stripe enforces 22-character limit
  @Matches(/^[a-zA-Z0-9 ]*$/, { message: 'statementDescriptor must contain only letters, numbers, and spaces' })
  statementDescriptor?: string;

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
