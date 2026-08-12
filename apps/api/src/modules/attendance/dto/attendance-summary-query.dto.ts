import { createZodDto } from 'nestjs-zod'
import { AttendanceSummaryQuerySchema } from '@studenthub/shared-schemas'

export class AttendanceSummaryQueryDto extends createZodDto(AttendanceSummaryQuerySchema) {}
