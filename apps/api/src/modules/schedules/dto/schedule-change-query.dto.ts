import { createZodDto } from 'nestjs-zod'
import { ScheduleChangeQuerySchema } from '@studenthub/shared-schemas'

export class ScheduleChangeQueryDto extends createZodDto(ScheduleChangeQuerySchema) {}
