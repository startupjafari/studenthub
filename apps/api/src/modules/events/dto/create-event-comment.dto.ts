import { createZodDto } from 'nestjs-zod'
import { CreateEventCommentSchema } from '@studenthub/shared-schemas'

export class CreateEventCommentDto extends createZodDto(CreateEventCommentSchema) {}
