import { createZodDto } from 'nestjs-zod'
import { BookCopyLabelsSchema } from '@studenthub/shared-schemas'

export class BookCopyLabelsDto extends createZodDto(BookCopyLabelsSchema) {}
