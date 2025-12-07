import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { EventType } from '@prisma/client';

export class GetEventsDto extends PaginationDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('4')
  universityId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('4')
  groupId?: string;

  @ApiProperty({ enum: EventType, required: false })
  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType;
}





