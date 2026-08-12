import { createZodDto } from 'nestjs-zod'
import { FacultyAnalyticsQuerySchema } from '@studenthub/shared-schemas'

export class FacultyAnalyticsQueryDto extends createZodDto(FacultyAnalyticsQuerySchema) {}
