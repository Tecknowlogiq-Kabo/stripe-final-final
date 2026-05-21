import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FlexibleFieldValueDto {
  @IsString()
  @IsNotEmpty()
  flexibleFieldVersionId: string;

  @IsString()
  @IsNotEmpty()
  fieldValueString: string;
}

export class CallbackHeaderDto {
  @IsString()
  @IsNotEmpty()
  Header: string;

  @IsString()
  @IsNotEmpty()
  Value: string;
}

export class CreateGuestLinkDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlexibleFieldValueDto)
  applicationFlexibleFieldValues?: FlexibleFieldValueDto[];

  @IsOptional()
  @IsString()
  clientApplicationReference?: string;

  @IsOptional()
  @IsNumber()
  digitalIdentityScheme?: number;

  @IsOptional()
  @IsString()
  rtraAgentName?: string;

  @IsOptional()
  @IsString()
  rtwCompanyName?: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CallbackHeaderDto)
  callbackHeaders?: CallbackHeaderDto[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
