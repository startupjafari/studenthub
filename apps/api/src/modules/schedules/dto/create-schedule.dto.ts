import { createZodDto } from 'nestjs-zod'
import { CreateScheduleSchema } from '@studenthub/shared-schemas'

export class CreateScheduleDto extends createZodDto(CreateScheduleSchema) {}
