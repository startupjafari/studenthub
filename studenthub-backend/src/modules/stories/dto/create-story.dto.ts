import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateStoryDto {
  @ApiProperty({ description: 'Story content', required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @ApiProperty({ description: 'Media ID (required)' })
  @IsUUID('4')
  @IsNotEmpty()
  mediaId: string;
}
