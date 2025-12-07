import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { ReactionType } from '@prisma/client';

export class CreateReactionDto {
  @ApiProperty({
    enum: ReactionType,
    description: 'Reaction type',
    example: ReactionType.LIKE,
  })
  @IsEnum(ReactionType)
  @IsNotEmpty()
  type: ReactionType;
}





