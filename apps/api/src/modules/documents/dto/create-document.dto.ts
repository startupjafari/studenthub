import { createZodDto } from 'nestjs-zod'
import { CreateDocumentSchema } from '@studenthub/shared-schemas'

export class CreateDocumentDto extends createZodDto(CreateDocumentSchema) {}
