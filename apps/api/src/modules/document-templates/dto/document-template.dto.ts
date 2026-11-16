import { createZodDto } from 'nestjs-zod'
import {
  CreateDocumentTemplateSchema,
  DocumentTemplateListQuerySchema,
  DocumentTemplateTestQuerySchema,
  GenerateDocumentFromTemplateSchema,
  UpdateDocumentTemplateSchema,
} from '@studenthub/shared-schemas'

export class CreateDocumentTemplateDto extends createZodDto(CreateDocumentTemplateSchema) {}
export class UpdateDocumentTemplateDto extends createZodDto(UpdateDocumentTemplateSchema) {}
export class DocumentTemplateListQueryDto extends createZodDto(DocumentTemplateListQuerySchema) {}
export class GenerateDocumentFromTemplateDto extends createZodDto(
  GenerateDocumentFromTemplateSchema,
) {}
export class DocumentTemplateTestQueryDto extends createZodDto(DocumentTemplateTestQuerySchema) {}
