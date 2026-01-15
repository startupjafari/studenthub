import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ConversationType } from '@prisma/client';

export class CreateConversationDto {
  @ApiProperty({
    enum: ConversationType,
    description: 'Conversation type',
    default: ConversationType.PRIVATE,
  })
  @IsEnum(ConversationType)
  @IsNotEmpty()
  type: ConversationType;

  @ApiProperty({
    type: [String],
    description: 'Participant IDs (for PRIVATE: 1 participant, for GROUP: multiple)',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  participantIds: string[];

  @ApiProperty({ required: false, description: 'Group name (for GROUP type)' })
  @IsOptional()
  name?: string;
}
