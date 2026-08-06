import { createZodDto } from 'nestjs-zod'
import { CreatePostSchema } from '@studenthub/shared-schemas'

export class CreatePostDto extends createZodDto(CreatePostSchema) {}
