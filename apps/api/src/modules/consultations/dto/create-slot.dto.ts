import { createZodDto } from 'nestjs-zod'
import { CreateSlotSchema } from '@studenthub/shared-schemas'

export class CreateSlotDto extends createZodDto(CreateSlotSchema) {}
