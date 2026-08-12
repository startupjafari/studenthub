import { createZodDto } from 'nestjs-zod'
import { ConfirmAppointmentSchema } from '@studenthub/shared-schemas'

export class ConfirmAppointmentDto extends createZodDto(ConfirmAppointmentSchema) {}
