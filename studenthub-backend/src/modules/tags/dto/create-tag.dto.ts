import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';

export class CreateTagDto {
  @ApiProperty({
    description: 'Tag name',
    example: 'javascript',
    minLength: 2,
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9а-яА-ЯёЁ_-]+$/, {
    message: 'Tag name can only contain letters, numbers, hyphens, and underscores',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Tag description',
    example: 'JavaScript programming language',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

