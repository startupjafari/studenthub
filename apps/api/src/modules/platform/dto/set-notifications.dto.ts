import { createZodDto } from 'nestjs-zod'
import { SetNotificationsSchema } from '@studenthub/shared-schemas'

export class SetNotificationsDto extends createZodDto(SetNotificationsSchema) {}
