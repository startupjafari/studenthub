import { createZodDto } from 'nestjs-zod'
import { ReplaceDocumentFileSchema } from '@studenthub/shared-schemas'

// { fileId } — новый файл на место заменяемой страницы.
export class ReplaceDocumentFileDto extends createZodDto(ReplaceDocumentFileSchema) {}
