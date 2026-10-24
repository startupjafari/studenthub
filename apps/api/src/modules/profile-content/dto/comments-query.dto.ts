import { createZodDto } from 'nestjs-zod'
import { CommentsQuerySchema } from '@studenthub/shared-schemas'

export class ContentCommentsQueryDto extends createZodDto(CommentsQuerySchema) {}
