import { createZodDto } from 'nestjs-zod'
import { ScheduleListQuerySchema } from '@studenthub/shared-schemas'

export class ScheduleListQueryDto extends createZodDto(ScheduleListQuerySchema) {}
