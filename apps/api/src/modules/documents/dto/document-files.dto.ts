import { createZodDto } from 'nestjs-zod'
import { ReorderDocumentFilesSchema } from '@studenthub/shared-schemas'

// Общая форма { fileIds } — для прикрепления и для изменения порядка.
export class DocumentFilesDto extends createZodDto(ReorderDocumentFilesSchema) {}
