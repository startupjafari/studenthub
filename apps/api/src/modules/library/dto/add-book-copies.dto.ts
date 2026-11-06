import { createZodDto } from 'nestjs-zod'
import { AddBookCopiesSchema } from '@studenthub/shared-schemas'

export class AddBookCopiesDto extends createZodDto(AddBookCopiesSchema) {}
