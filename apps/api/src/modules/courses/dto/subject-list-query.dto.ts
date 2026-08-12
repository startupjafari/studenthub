import { createZodDto } from 'nestjs-zod'
import { SubjectListQuerySchema } from '@studenthub/shared-schemas'

export class SubjectListQueryDto extends createZodDto(SubjectListQuerySchema) {}
