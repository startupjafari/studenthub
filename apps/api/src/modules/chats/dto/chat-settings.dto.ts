import { createZodDto } from 'nestjs-zod'
import { ChatSettingsUpdateSchema } from '@studenthub/shared-schemas'

// Личные настройки чатов (§9): своя быстрая реакция; null — вернуть общую по умолчанию.
export class ChatSettingsUpdateDto extends createZodDto(ChatSettingsUpdateSchema) {}
