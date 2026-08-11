import { createZodDto } from 'nestjs-zod'
import { AttachApplicationDocumentSchema } from '@studenthub/shared-schemas'

export class AttachDocumentDto extends createZodDto(AttachApplicationDocumentSchema) {}
