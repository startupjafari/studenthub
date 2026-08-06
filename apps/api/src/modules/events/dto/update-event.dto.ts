import { createZodDto } from 'nestjs-zod'
import { UpdateEventSchema } from '@studenthub/shared-schemas'

export class UpdateEventDto extends createZodDto(UpdateEventSchema) {}
