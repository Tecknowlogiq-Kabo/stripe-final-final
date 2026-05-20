import { IsString, IsOptional, IsInt, Min, Max, IsObject } from 'class-validator';

export class CreateTrustTokenDto {
  @IsString()
  resourceType: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(604800) // Max 7 days
  ttlSeconds?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
