import { createZodDto } from 'nestjs-zod'
import { CreateStoryHighlightSchema } from '@studenthub/shared-schemas'

export class CreateStoryHighlightDto extends createZodDto(CreateStoryHighlightSchema) {}
