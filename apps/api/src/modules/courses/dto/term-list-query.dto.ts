import { createZodDto } from 'nestjs-zod'
import { TermListQuerySchema } from '@studenthub/shared-schemas'

export class TermListQueryDto extends createZodDto(TermListQuerySchema) {}
