import { createZodDto } from 'nestjs-zod'
import {
  MultipartDomainAbortSchema,
  MultipartDomainCompleteSchema,
  MultipartDomainStartSchema,
  MultipartDomainUrlsSchema,
} from '@studenthub/shared-schemas'

// Многочастная загрузка файла материала (21.B1): бакет неявный, его выбирает модуль.
// Имена классов уникальны по модулям — по ним Swagger называет схемы в openapi.json.
export class MaterialFileMultipartStartDto extends createZodDto(MultipartDomainStartSchema) {}
export class MaterialFileMultipartUrlsDto extends createZodDto(MultipartDomainUrlsSchema) {}
export class MaterialFileMultipartCompleteDto extends createZodDto(MultipartDomainCompleteSchema) {}
export class MaterialFileMultipartAbortDto extends createZodDto(MultipartDomainAbortSchema) {}
