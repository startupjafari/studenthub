import { createZodDto } from 'nestjs-zod'
import { AddStoryHighlightItemSchema } from '@studenthub/shared-schemas'

export class AddStoryHighlightItemDto extends createZodDto(AddStoryHighlightItemSchema) {}
