import { createZodDto } from 'nestjs-zod'
import { AnalyticsReportQuerySchema } from '@studenthub/shared-schemas'

/** ?period=month|quarter|year&facultyId=&format=xlsx|csv&locale=ru|kk|en — отчёт по сводке. */
export class AnalyticsReportQueryDto extends createZodDto(AnalyticsReportQuerySchema) {}
