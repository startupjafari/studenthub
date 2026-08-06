import { createZodDto } from 'nestjs-zod'
import { UploadFileSchema } from '@studenthub/shared-schemas'

export class UploadFileDto extends createZodDto(UploadFileSchema) {}
