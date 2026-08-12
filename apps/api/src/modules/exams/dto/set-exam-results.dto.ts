import { createZodDto } from 'nestjs-zod'
import { SetExamResultsSchema } from '@studenthub/shared-schemas'

export class SetExamResultsDto extends createZodDto(SetExamResultsSchema) {}
