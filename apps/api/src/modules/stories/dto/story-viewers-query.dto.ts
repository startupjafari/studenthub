import { createZodDto } from 'nestjs-zod'
import { StoryViewersQuerySchema } from '@studenthub/shared-schemas'

export class StoryViewersQueryDto extends createZodDto(StoryViewersQuerySchema) {}
