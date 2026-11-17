import { createZodDto } from 'nestjs-zod'
import { ChatAttentionReadSchema } from '@studenthub/shared-schemas'

/** Прочитать упоминания или реакции чата: показанные сообщения или все (без `messageIds`). */
export class ChatAttentionReadDto extends createZodDto(ChatAttentionReadSchema) {}
