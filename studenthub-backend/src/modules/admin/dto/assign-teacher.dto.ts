import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';

export class AssignTeacherDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeId: string;

  @ApiProperty({ description: 'Department name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  department: string;

  @ApiProperty({ description: 'Specialization' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  specialization: string;

  @ApiProperty({
    description: 'Qualifications',
    type: [String],
    example: ["Master's Degree", 'PhD'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  qualifications: string[];
}





