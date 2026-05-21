import { IsOptional, IsString } from 'class-validator';

export class ApproveTrustDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
