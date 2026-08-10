import { createZodDto } from 'nestjs-zod'
import { SendFriendRequestSchema } from '@studenthub/shared-schemas'

export class SendFriendRequestDto extends createZodDto(SendFriendRequestSchema) {}
