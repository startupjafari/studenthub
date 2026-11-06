import { createZodDto } from 'nestjs-zod'
import { CreateBookSchema } from '@studenthub/shared-schemas'

export class CreateBookDto extends createZodDto(CreateBookSchema) {}
