import { createZodDto } from 'nestjs-zod'
import { ChatExportFileQuerySchema } from '@studenthub/shared-schemas'

// Выгрузка истории чата файлом: ?format=txt|json&locale=ru|kk|en.
export class ChatExportFileQueryDto extends createZodDto(ChatExportFileQuerySchema) {}
