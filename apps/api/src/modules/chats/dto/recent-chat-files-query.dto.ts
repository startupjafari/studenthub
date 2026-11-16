import { createZodDto } from 'nestjs-zod'
import { RecentChatFilesQuerySchema } from '@studenthub/shared-schemas'

// Недавние файлы листа вложений: ?kind=document|audio&q=&cursor=&limit=.
export class RecentChatFilesQueryDto extends createZodDto(RecentChatFilesQuerySchema) {}
