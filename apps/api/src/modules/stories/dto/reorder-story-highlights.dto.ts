import { createZodDto } from 'nestjs-zod'
import { ReorderStoryHighlightsSchema } from '@studenthub/shared-schemas'

export class ReorderStoryHighlightsDto extends createZodDto(ReorderStoryHighlightsSchema) {}
