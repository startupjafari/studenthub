import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { ModerationAction } from '@prisma/client';

export class ModerateReportDto {
  @ApiProperty({
    description: 'Moderation action to take',
    enum: ModerationAction,
    example: ModerationAction.DELETE_CONTENT,
  })
  @IsEnum(ModerationAction)
  @IsNotEmpty()
  action: ModerationAction;

  @ApiPropertyOptional({
    description: 'Note about the moderation action',
    example: 'Content violates community guidelines',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}




