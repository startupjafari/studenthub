import { createZodDto } from 'nestjs-zod'
import { BookListQuerySchema } from '@studenthub/shared-schemas'

export class BookListQueryDto extends createZodDto(BookListQuerySchema) {}
