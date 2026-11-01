import { createZodDto } from 'nestjs-zod'
import { StoryReplySchema } from '@studenthub/shared-schemas'

export class StoryReplyDto extends createZodDto(StoryReplySchema) {}
