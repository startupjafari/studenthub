import { createZodDto } from 'nestjs-zod'
import { ChatMediaQuerySchema } from '@studenthub/shared-schemas'

// Общие материалы чата (§23): ?type=media|file|voice + cursor/limit.
export class ChatMediaQueryDto extends createZodDto(ChatMediaQuerySchema) {}
