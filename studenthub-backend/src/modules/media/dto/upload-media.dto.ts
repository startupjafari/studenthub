import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { MediaType } from '@prisma/client';

export class UploadMediaDto {
  @ApiProperty({
    enum: MediaType,
    description: 'Media type',
    example: MediaType.IMAGE,
  })
  @IsEnum(MediaType)
  @IsNotEmpty()
  type: MediaType;
}
