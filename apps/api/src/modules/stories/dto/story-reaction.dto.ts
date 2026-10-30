import { createZodDto } from 'nestjs-zod'
import { StoryReactionSchema } from '@studenthub/shared-schemas'

export class StoryReactionDto extends createZodDto(StoryReactionSchema) {}
