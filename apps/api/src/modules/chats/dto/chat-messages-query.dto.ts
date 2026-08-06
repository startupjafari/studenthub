import { createZodDto } from 'nestjs-zod'
import { ChatMessagesQuerySchema } from '@studenthub/shared-schemas'

export class ChatMessagesQueryDto extends createZodDto(ChatMessagesQuerySchema) {}
