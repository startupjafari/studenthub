import { createZodDto } from 'nestjs-zod'
import { AttendanceRosterQuerySchema } from '@studenthub/shared-schemas'

export class AttendanceRosterQueryDto extends createZodDto(AttendanceRosterQuerySchema) {}
