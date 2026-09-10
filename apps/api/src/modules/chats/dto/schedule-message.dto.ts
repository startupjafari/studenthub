import { createZodDto } from 'nestjs-zod'
import { ScheduleMessageSchema } from '@studenthub/shared-schemas'

export class ScheduleMessageDto extends createZodDto(ScheduleMessageSchema) {}
