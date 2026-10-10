import { createZodDto } from 'nestjs-zod'
import { StoryVoteSchema } from '@studenthub/shared-schemas'

export class StoryVoteDto extends createZodDto(StoryVoteSchema) {}
