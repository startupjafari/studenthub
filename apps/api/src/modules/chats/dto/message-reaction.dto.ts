import { createZodDto } from 'nestjs-zod'
import { MessageReactionSchema } from '@studenthub/shared-schemas'

export class MessageReactionDto extends createZodDto(MessageReactionSchema) {}
