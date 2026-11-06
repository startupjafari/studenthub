import { createZodDto } from 'nestjs-zod'
import { EventParticipantsQuerySchema } from '@studenthub/shared-schemas'

export class EventParticipantsQueryDto extends createZodDto(EventParticipantsQuerySchema) {}
