import { createZodDto } from 'nestjs-zod'
import {
  PlatformDocumentAccessSchema,
  PlatformDocumentMetaSchema,
} from '@studenthub/shared-schemas'

export class PlatformAccessDto extends createZodDto(PlatformDocumentAccessSchema) {}
export class PlatformMetaDto extends createZodDto(PlatformDocumentMetaSchema) {}
