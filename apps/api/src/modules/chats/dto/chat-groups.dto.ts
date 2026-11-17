import { createZodDto } from 'nestjs-zod'
import { ChatJoinSettingsSchema, UpdateChatPermissionsSchema } from '@studenthub/shared-schemas'

export class UpdateChatPermissionsDto extends createZodDto(UpdateChatPermissionsSchema) {}
export class ChatJoinSettingsDto extends createZodDto(ChatJoinSettingsSchema) {}
