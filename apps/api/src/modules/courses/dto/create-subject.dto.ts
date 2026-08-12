import { createZodDto } from 'nestjs-zod'
import { CreateSubjectSchema } from '@studenthub/shared-schemas'

export class CreateSubjectDto extends createZodDto(CreateSubjectSchema) {}
