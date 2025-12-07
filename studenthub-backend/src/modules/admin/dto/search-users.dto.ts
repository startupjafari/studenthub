import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AdminSearchUsersDto extends PaginationDto {
  @ApiProperty({ required: false, description: 'Search by email or name' })
  @IsOptional()
  @IsString()
  q?: string;
}





