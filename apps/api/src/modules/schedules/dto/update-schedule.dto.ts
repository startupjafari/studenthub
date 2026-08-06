import { createZodDto } from 'nestjs-zod'
import { UpdateScheduleSchema } from '@studenthub/shared-schemas'

export class UpdateScheduleDto extends createZodDto(UpdateScheduleSchema) {}
