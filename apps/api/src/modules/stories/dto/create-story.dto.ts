import { createZodDto } from 'nestjs-zod'
import { CreateStorySchema } from '@studenthub/shared-schemas'

export class CreateStoryDto extends createZodDto(CreateStorySchema) {}
