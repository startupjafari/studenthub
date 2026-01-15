import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { GroupRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({ description: 'User ID' })
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    enum: GroupRole,
    description: 'Member role',
    default: GroupRole.MEMBER,
    required: false,
  })
  @IsEnum(GroupRole)
  @IsOptional()
  role?: GroupRole = GroupRole.MEMBER;
}
