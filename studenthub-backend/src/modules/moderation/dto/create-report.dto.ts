import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ReportResourceType, ReportReason } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty({
    description: 'Type of resource being reported',
    enum: ReportResourceType,
    example: ReportResourceType.POST,
  })
  @IsEnum(ReportResourceType)
  @IsNotEmpty()
  resourceType: ReportResourceType;

  @ApiProperty({
    description: 'ID of the resource being reported',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  resourceId: string;

  @ApiProperty({
    description: 'Reason for reporting',
    enum: ReportReason,
    example: ReportReason.SPAM,
  })
  @IsEnum(ReportReason)
  @IsNotEmpty()
  reason: ReportReason;

  @ApiPropertyOptional({
    description: 'Additional description',
    example: 'This post contains inappropriate content',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
