import { IsString, IsOptional, IsInt, Min, Max, IsObject, IsArray, ValidateNested, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';

export class TrustFlexibleFieldDto {
  @IsString()
  flexibleFieldVersionId: string;

  @IsString()
  fieldValueString: string;
}

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

  // TrustID-specific fields (optional — only used when creating TrustID guest links)
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  clientApplicationReference?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrustFlexibleFieldDto)
  applicationFlexibleFieldValues?: TrustFlexibleFieldDto[];
}
