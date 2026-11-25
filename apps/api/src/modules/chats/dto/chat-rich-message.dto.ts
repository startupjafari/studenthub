import { createZodDto } from 'nestjs-zod'
import {
  ChatChecklistCreateSchema,
  ChatContactSchema,
  ChatLocationSchema,
  LiveLocationUpdateSchema,
  ChatPollsQuerySchema,
} from '@studenthub/shared-schemas'

// Особые сообщения чата: геопозиция, контакт, чек-лист — и их списки.
export class ChatLocationDto extends createZodDto(ChatLocationSchema) {}
export class ChatContactDto extends createZodDto(ChatContactSchema) {}
export class ChatChecklistCreateDto extends createZodDto(ChatChecklistCreateSchema) {}
export class ChatPollsQueryDto extends createZodDto(ChatPollsQuerySchema) {}
export class LiveLocationUpdateDto extends createZodDto(LiveLocationUpdateSchema) {}
