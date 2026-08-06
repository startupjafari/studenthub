import { createZodDto } from 'nestjs-zod'
import { MessageSearchQuerySchema } from '@studenthub/shared-schemas'

export class MessageSearchQueryDto extends createZodDto(MessageSearchQuerySchema) {}
