import { createZodDto } from 'nestjs-zod'
import { CreateAppointmentSchema } from '@studenthub/shared-schemas'

export class CreateAppointmentDto extends createZodDto(CreateAppointmentSchema) {}
