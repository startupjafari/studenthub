import { createZodDto } from 'nestjs-zod'
import { StoryHighlightsQuerySchema } from '@studenthub/shared-schemas'

export class StoryHighlightsQueryDto extends createZodDto(StoryHighlightsQuerySchema) {}
