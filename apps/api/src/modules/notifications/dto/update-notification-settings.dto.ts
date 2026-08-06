import { createZodDto } from 'nestjs-zod'
import { UpdateNotificationSettingsSchema } from '@studenthub/shared-schemas'

export class UpdateNotificationSettingsDto extends createZodDto(UpdateNotificationSettingsSchema) {}
