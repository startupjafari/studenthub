import { createZodDto } from 'nestjs-zod'
import { EventListQuerySchema } from '@studenthub/shared-schemas'

export class EventListQueryDto extends createZodDto(EventListQuerySchema) {}
