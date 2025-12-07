import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({ description: 'Message content', required: false, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiProperty({ description: 'Media ID', required: false })
  @IsOptional()
  @IsUUID('4')
  mediaId?: string;
}





