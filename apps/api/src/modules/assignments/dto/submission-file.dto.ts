import { createZodDto } from 'nestjs-zod'
import { ConfirmDomainUploadSchema, PresignDomainUploadSchema } from '@studenthub/shared-schemas'

// Прямая загрузка файла сдачи: бакет неявный, его выбирает модуль заданий.
export class PresignSubmissionFileDto extends createZodDto(PresignDomainUploadSchema) {}
export class ConfirmSubmissionFileDto extends createZodDto(ConfirmDomainUploadSchema) {}
