import { createZodDto } from 'nestjs-zod'
import { SupportQueueQuerySchema } from '@studenthub/shared-schemas'

export class SupportQueueQueryDto extends createZodDto(SupportQueueQuerySchema) {}
