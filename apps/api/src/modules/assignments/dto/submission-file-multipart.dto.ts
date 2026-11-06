import { createZodDto } from 'nestjs-zod'
import {
  MultipartDomainAbortSchema,
  MultipartDomainCompleteSchema,
  MultipartDomainStartSchema,
  MultipartDomainUrlsSchema,
} from '@studenthub/shared-schemas'

// Многочастная загрузка файла сдачи (21.B1): бакет неявный, его выбирает модуль заданий.
// Имена классов уникальны по модулям — по ним Swagger называет схемы в openapi.json.
export class SubmissionFileMultipartStartDto extends createZodDto(MultipartDomainStartSchema) {}
export class SubmissionFileMultipartUrlsDto extends createZodDto(MultipartDomainUrlsSchema) {}
export class SubmissionFileMultipartCompleteDto extends createZodDto(
  MultipartDomainCompleteSchema,
) {}
export class SubmissionFileMultipartAbortDto extends createZodDto(MultipartDomainAbortSchema) {}
