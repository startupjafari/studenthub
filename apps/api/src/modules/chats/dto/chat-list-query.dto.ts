import { createZodDto } from 'nestjs-zod'
import { ChatListQuerySchema } from '@studenthub/shared-schemas'

export class ChatListQueryDto extends createZodDto(ChatListQuerySchema) {}
