import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { GroupRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: GroupRole, description: 'New role' })
  @IsEnum(GroupRole)
  @IsNotEmpty()
  role: GroupRole;
}
