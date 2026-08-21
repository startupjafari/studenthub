import { createZodDto } from 'nestjs-zod'
import { ConfirmDomainUploadSchema, PresignDomainUploadSchema } from '@studenthub/shared-schemas'

export class PresignMaterialFileDto extends createZodDto(PresignDomainUploadSchema) {}
export class ConfirmMaterialFileDto extends createZodDto(ConfirmDomainUploadSchema) {}
