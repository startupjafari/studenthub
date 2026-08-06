import { createZodDto } from 'nestjs-zod'
import { PlatformDocumentAccessSchema } from '@studenthub/shared-schemas'

export class PlatformAccessDto extends createZodDto(PlatformDocumentAccessSchema) {}
