import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class Disable2FADto {
  @ApiProperty({
    description: '6-digit verification code from authenticator app (required to disable)',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: '2FA code must be 6 digits' })
  code: string;
}

