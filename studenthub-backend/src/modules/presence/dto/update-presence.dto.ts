import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PresenceStatus } from '@prisma/client';

export class UpdatePresenceDto {
  @ApiProperty({
    description: 'Presence status',
    enum: PresenceStatus,
    example: PresenceStatus.ONLINE,
  })
  @IsEnum(PresenceStatus)
  status: PresenceStatus;
}


