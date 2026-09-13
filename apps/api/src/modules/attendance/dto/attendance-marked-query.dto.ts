import { createZodDto } from 'nestjs-zod'
import { AttendanceMarkedQuerySchema } from '@studenthub/shared-schemas'

export class AttendanceMarkedQueryDto extends createZodDto(AttendanceMarkedQuerySchema) {}
