import { createZodDto } from 'nestjs-zod'
import { CreateEventSchema } from '@studenthub/shared-schemas'

export class CreateEventDto extends createZodDto(CreateEventSchema) {}
