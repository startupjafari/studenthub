import { createZodDto } from 'nestjs-zod'
import { CreateChatFolderSchema, UpdateChatFolderSchema } from '@studenthub/shared-schemas'

// Папки чатов (§2): создание — имя + необязательный стартовый состав; правка — имя,
// состав (целиком) и/или позиция вкладки.
export class CreateChatFolderDto extends createZodDto(CreateChatFolderSchema) {}
export class UpdateChatFolderDto extends createZodDto(UpdateChatFolderSchema) {}
