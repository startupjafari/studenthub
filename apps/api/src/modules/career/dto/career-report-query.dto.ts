import { createZodDto } from 'nestjs-zod'
import { CareerReportQuerySchema } from '@studenthub/shared-schemas'

/** ?period=month|quarter|year + ?universityId — аналитический отчёт карьерного центра. */
export class CareerReportQueryDto extends createZodDto(CareerReportQuerySchema) {}
