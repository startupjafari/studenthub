import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class GetTagsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search query for tag name',
    example: 'java',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
