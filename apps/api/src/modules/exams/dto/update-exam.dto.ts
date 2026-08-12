import { createZodDto } from 'nestjs-zod'
import { UpdateExamSchema } from '@studenthub/shared-schemas'

export class UpdateExamDto extends createZodDto(UpdateExamSchema) {}
