import { createZodDto } from 'nestjs-zod'
import {
  CreateCustomDocumentTypeSchema,
  UpdateDocumentTypeSchema,
} from '@studenthub/shared-schemas'

export class UpdateDocumentTypeDto extends createZodDto(UpdateDocumentTypeSchema) {}
export class CreateCustomDocumentTypeDto extends createZodDto(CreateCustomDocumentTypeSchema) {}
