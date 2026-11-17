import { createZodDto } from 'nestjs-zod'
import { MessageSearchQuerySchema, TopPeersQuerySchema } from '@studenthub/shared-schemas'

export class MessageSearchQueryDto extends createZodDto(MessageSearchQuerySchema) {}

export class TopPeersQueryDto extends createZodDto(TopPeersQuerySchema) {}
