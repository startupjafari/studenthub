import { createZodDto } from 'nestjs-zod'
import { UpdateDocumentSchema } from '@studenthub/shared-schemas'

export class UpdateDocumentDto extends createZodDto(UpdateDocumentSchema) {}
