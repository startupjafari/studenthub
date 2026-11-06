import { createZodDto } from 'nestjs-zod'
import { CommentsQuerySchema } from '@studenthub/shared-schemas'

export class PollCommentsQueryDto extends createZodDto(CommentsQuerySchema) {}
