import { createZodDto } from 'nestjs-zod'
import { NotificationListQuerySchema } from '@studenthub/shared-schemas'

export class NotificationListQueryDto extends createZodDto(NotificationListQuerySchema) {}
