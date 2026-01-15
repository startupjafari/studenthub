import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PostVisibility } from '@prisma/client';

export class CreatePostDto {
  @ApiProperty({ description: 'Post content', maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiProperty({
    enum: PostVisibility,
    description: 'Post visibility',
    default: PostVisibility.PUBLIC,
    required: false,
  })
  @IsEnum(PostVisibility)
  @IsOptional()
  visibility?: PostVisibility = PostVisibility.PUBLIC;

  @ApiProperty({
    type: [String],
    description: 'Media IDs (UUID format)',
    required: false,
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  mediaIds?: string[];
}
