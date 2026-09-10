import { createZodDto } from 'nestjs-zod'
import { UpdateScheduledMessageSchema } from '@studenthub/shared-schemas'

export class UpdateScheduledMessageDto extends createZodDto(UpdateScheduledMessageSchema) {}
