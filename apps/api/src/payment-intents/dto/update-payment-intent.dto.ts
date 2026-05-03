import { IsOptional, IsObject, IsString, MaxLength } from 'class-validator';

export class UpdatePaymentIntentDto {
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}
