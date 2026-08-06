import { createZodDto } from 'nestjs-zod'
import { FeedQuerySchema } from '@studenthub/shared-schemas'

export class FeedQueryDto extends createZodDto(FeedQuerySchema) {}
