import { createZodDto } from 'nestjs-zod'
import { BookSlotSchema } from '@studenthub/shared-schemas'

export class BookSlotDto extends createZodDto(BookSlotSchema) {}
