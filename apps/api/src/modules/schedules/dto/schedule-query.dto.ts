import { createZodDto } from 'nestjs-zod'
import { ScheduleQuerySchema } from '@studenthub/shared-schemas'

export class ScheduleQueryDto extends createZodDto(ScheduleQuerySchema) {}
