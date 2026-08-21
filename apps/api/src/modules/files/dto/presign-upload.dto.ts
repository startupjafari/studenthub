import { createZodDto } from 'nestjs-zod'
import { ConfirmUploadSchema, PresignUploadSchema } from '@studenthub/shared-schemas'

export class PresignUploadDto extends createZodDto(PresignUploadSchema) {}
export class ConfirmUploadDto extends createZodDto(ConfirmUploadSchema) {}
