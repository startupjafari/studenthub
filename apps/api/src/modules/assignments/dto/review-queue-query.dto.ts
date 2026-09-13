import { createZodDto } from 'nestjs-zod'
import { ReviewQueueQuerySchema } from '@studenthub/shared-schemas'

export class ReviewQueueQueryDto extends createZodDto(ReviewQueueQuerySchema) {}
