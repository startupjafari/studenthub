import { createZodDto } from 'nestjs-zod'
import { ConfirmDomainUploadSchema, PresignDomainUploadSchema } from '@studenthub/shared-schemas'

export class PresignDocumentFileDto extends createZodDto(PresignDomainUploadSchema) {}
export class ConfirmDocumentFileDto extends createZodDto(ConfirmDomainUploadSchema) {}
