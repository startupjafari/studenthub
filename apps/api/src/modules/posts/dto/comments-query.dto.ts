import { createZodDto } from 'nestjs-zod'
import { CommentsQuerySchema } from '@studenthub/shared-schemas'

export class CommentsQueryDto extends createZodDto(CommentsQuerySchema) {}
