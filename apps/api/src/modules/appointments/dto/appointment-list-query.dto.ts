import { createZodDto } from 'nestjs-zod'
import { AppointmentListQuerySchema } from '@studenthub/shared-schemas'

export class AppointmentListQueryDto extends createZodDto(AppointmentListQuerySchema) {}
