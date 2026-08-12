import { createZodDto } from 'nestjs-zod'
import { UpdateSubjectSchema } from '@studenthub/shared-schemas'

export class UpdateSubjectDto extends createZodDto(UpdateSubjectSchema) {}
