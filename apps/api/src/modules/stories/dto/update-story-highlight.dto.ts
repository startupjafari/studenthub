import { createZodDto } from 'nestjs-zod'
import { UpdateStoryHighlightSchema } from '@studenthub/shared-schemas'

export class UpdateStoryHighlightDto extends createZodDto(UpdateStoryHighlightSchema) {}
