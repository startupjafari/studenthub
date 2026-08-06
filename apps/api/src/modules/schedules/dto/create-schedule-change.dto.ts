import { createZodDto } from 'nestjs-zod'
import { CreateScheduleChangeSchema } from '@studenthub/shared-schemas'

export class CreateScheduleChangeDto extends createZodDto(CreateScheduleChangeSchema) {}
