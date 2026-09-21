import { createZodDto } from 'nestjs-zod'
import { SupportReplySchema } from '@studenthub/shared-schemas'

export class SupportReplyDto extends createZodDto(SupportReplySchema) {}
