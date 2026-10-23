import { createZodDto } from 'nestjs-zod'
import { ApplicationDocumentUrlQuerySchema } from '@studenthub/shared-schemas'

export class ApplicationDocumentUrlQueryDto extends createZodDto(
  ApplicationDocumentUrlQuerySchema,
) {}
