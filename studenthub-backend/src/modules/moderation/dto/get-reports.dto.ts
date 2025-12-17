import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ReportStatus } from '@prisma/client';

export class GetReportsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by report status',
    enum: ReportStatus,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}


