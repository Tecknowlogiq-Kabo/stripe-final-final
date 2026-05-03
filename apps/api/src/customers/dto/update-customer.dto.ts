import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  IsObject,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
