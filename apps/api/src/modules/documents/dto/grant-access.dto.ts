import { createZodDto } from 'nestjs-zod'
import { GrantDocumentAccessSchema } from '@studenthub/shared-schemas'

export class GrantAccessDto extends createZodDto(GrantDocumentAccessSchema) {}
