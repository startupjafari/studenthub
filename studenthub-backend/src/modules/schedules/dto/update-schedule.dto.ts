import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsDateString,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class UpdateScheduleDto {
  @ApiPropertyOptional({
    description: 'Schedule title',
    example: 'Математика - Лекция 1',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: 'Schedule description',
    example: 'Введение в математический анализ',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Start time',
    example: '2024-01-15T10:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiPropertyOptional({
    description: 'End time',
    example: '2024-01-15T11:30:00Z',
  })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional({
    description: 'Location',
    example: 'Аудитория 101',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({
    description: 'Is online event',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional({
    description: 'Meeting link (for online events)',
    example: 'https://zoom.us/j/123456789',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLink?: string;
}


