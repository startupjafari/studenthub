import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsOptional, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'student@university.edu',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePass123',
  })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({
    description: 'Two-factor authentication code (required if 2FA is enabled)',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: '2FA code must be 6 digits' })
  twoFactorCode?: string;
}

