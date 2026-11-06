import { createZodDto } from 'nestjs-zod'
import { UpdateBookSchema } from '@studenthub/shared-schemas'

export class UpdateBookDto extends createZodDto(UpdateBookSchema) {}
