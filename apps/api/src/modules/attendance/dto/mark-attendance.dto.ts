import { createZodDto } from 'nestjs-zod'
import { MarkAttendanceSchema } from '@studenthub/shared-schemas'

export class MarkAttendanceDto extends createZodDto(MarkAttendanceSchema) {}
