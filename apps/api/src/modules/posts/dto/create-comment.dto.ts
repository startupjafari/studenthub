import { createZodDto } from 'nestjs-zod'
import { CreateCommentSchema } from '@studenthub/shared-schemas'

export class CreateCommentDto extends createZodDto(CreateCommentSchema) {}
