import { createZodDto } from 'nestjs-zod'
import {
  ChatChecklistCreateSchema,
  ChatContactSchema,
  ChatGifExternalSendSchema,
  ChatGifRecentQuerySchema,
  ChatGifSearchQuerySchema,
  ChatGifSendSchema,
  ChatGifTrendingQuerySchema,
  ChatLocationSchema,
  LiveLocationUpdateSchema,
  ChatPollsQuerySchema,
  ChatStickerSendSchema,
} from '@studenthub/shared-schemas'

// Особые сообщения чата: геопозиция, контакт, чек-лист, стикер, GIF — и их списки.
export class ChatLocationDto extends createZodDto(ChatLocationSchema) {}
export class ChatContactDto extends createZodDto(ChatContactSchema) {}
export class ChatChecklistCreateDto extends createZodDto(ChatChecklistCreateSchema) {}
export class ChatStickerSendDto extends createZodDto(ChatStickerSendSchema) {}
export class ChatGifSendDto extends createZodDto(ChatGifSendSchema) {}
export class ChatGifRecentQueryDto extends createZodDto(ChatGifRecentQuerySchema) {}
export class ChatPollsQueryDto extends createZodDto(ChatPollsQuerySchema) {}
export class LiveLocationUpdateDto extends createZodDto(LiveLocationUpdateSchema) {}
export class ChatGifTrendingQueryDto extends createZodDto(ChatGifTrendingQuerySchema) {}
export class ChatGifSearchQueryDto extends createZodDto(ChatGifSearchQuerySchema) {}
export class ChatGifExternalSendDto extends createZodDto(ChatGifExternalSendSchema) {}
