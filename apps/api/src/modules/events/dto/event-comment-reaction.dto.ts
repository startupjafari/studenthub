import { createZodDto } from 'nestjs-zod'
import { EventCommentReactionSchema } from '@studenthub/shared-schemas'

export class EventCommentReactionDto extends createZodDto(EventCommentReactionSchema) {}
