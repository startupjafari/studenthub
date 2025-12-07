import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsUUID } from 'class-validator';
import { AdminRole } from '@prisma/client';

export class AssignAdminDto {
  @ApiProperty({ description: 'User ID' })
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Admin role',
    enum: AdminRole,
    example: AdminRole.ADMIN,
  })
  @IsEnum(AdminRole)
  @IsNotEmpty()
  role: AdminRole;
}





