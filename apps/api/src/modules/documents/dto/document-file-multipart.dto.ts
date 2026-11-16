import { createZodDto } from 'nestjs-zod'
import {
  MultipartDomainAbortSchema,
  MultipartDomainCompleteSchema,
  MultipartDomainStartSchema,
  MultipartDomainUrlsSchema,
} from '@studenthub/shared-schemas'

// Многочастная загрузка файла документа (21.B1): бакет неявный, его выбирает модуль.
// Имена классов уникальны по модулям — по ним Swagger называет схемы в openapi.json.
export class DocumentFileMultipartStartDto extends createZodDto(MultipartDomainStartSchema) {}
export class DocumentFileMultipartUrlsDto extends createZodDto(MultipartDomainUrlsSchema) {}
export class DocumentFileMultipartCompleteDto extends createZodDto(MultipartDomainCompleteSchema) {}
export class DocumentFileMultipartAbortDto extends createZodDto(MultipartDomainAbortSchema) {}
