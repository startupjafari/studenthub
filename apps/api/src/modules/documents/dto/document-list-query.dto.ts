import { createZodDto } from 'nestjs-zod'
import { DocumentListQuerySchema } from '@studenthub/shared-schemas'

export class DocumentListQueryDto extends createZodDto(DocumentListQuerySchema) {}
