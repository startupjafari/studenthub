import { createZodDto } from 'nestjs-zod'
import { ContentCommentSchema } from '@studenthub/shared-schemas'

export class PollCommentDto extends createZodDto(ContentCommentSchema) {}
