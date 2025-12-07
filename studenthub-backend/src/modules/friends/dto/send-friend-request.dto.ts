import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';

export class SendFriendRequestDto {
  @ApiProperty({ description: 'Receiver user ID' })
  @IsUUID('4')
  @IsNotEmpty()
  receiverId: string;
}





