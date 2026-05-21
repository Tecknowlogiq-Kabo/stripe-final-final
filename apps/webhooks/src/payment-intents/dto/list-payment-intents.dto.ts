import { IsOptional, IsString, IsDateString, IsIn } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListPaymentIntentsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'amount'])
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @IsString()
  sortOrder?: string = 'DESC';
}
