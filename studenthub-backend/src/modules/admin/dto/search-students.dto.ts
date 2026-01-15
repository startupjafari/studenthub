import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AcademicStatus } from '@prisma/client';

export class SearchStudentsDto extends PaginationDto {
  @ApiProperty({ required: false, description: 'Search query' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    required: false,
    enum: AcademicStatus,
    description: 'Filter by academic status',
  })
  @IsOptional()
  @IsEnum(AcademicStatus)
  academicStatus?: AcademicStatus;
}
