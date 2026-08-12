import { createZodDto } from 'nestjs-zod'
import { CreateExamSchema } from '@studenthub/shared-schemas'

export class CreateExamDto extends createZodDto(CreateExamSchema) {}
