import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class GetGroupMessagesDto extends PaginationDto {
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 50;
}





