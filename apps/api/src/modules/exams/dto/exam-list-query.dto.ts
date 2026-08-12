import { createZodDto } from 'nestjs-zod'
import { ExamListQuerySchema } from '@studenthub/shared-schemas'

export class ExamListQueryDto extends createZodDto(ExamListQuerySchema) {}
