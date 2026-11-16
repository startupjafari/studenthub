import { createZodDto } from 'nestjs-zod'
import {
  ChatFolderMuteSchema,
  ChatFoldersOrderSchema,
  CreateChatFolderSchema,
  UpdateChatFolderSchema,
} from '@studenthub/shared-schemas'

// Папки чатов (§2): создание — имя + необязательный стартовый состав, значок, цвет и правила;
// правка — те же поля и/или позиция вкладки; порядок вкладок целиком; заглушение всей папки.
export class CreateChatFolderDto extends createZodDto(CreateChatFolderSchema) {}
export class UpdateChatFolderDto extends createZodDto(UpdateChatFolderSchema) {}
export class ChatFoldersOrderDto extends createZodDto(ChatFoldersOrderSchema) {}
export class ChatFolderMuteDto extends createZodDto(ChatFolderMuteSchema) {}
