import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class CreateScheduleDto {
  @ApiProperty({
    description: 'Group ID',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({
    description: 'Schedule title',
    example: 'Математика - Лекция 1',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description: 'Schedule description',
    example: 'Введение в математический анализ',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    description: 'Start time',
    example: '2024-01-15T10:00:00Z',
  })
  @IsDateString()
  @IsNotEmpty()
  startTime: string;

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
    default: false,
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




