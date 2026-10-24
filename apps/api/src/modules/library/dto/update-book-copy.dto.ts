import { createZodDto } from 'nestjs-zod'
import { UpdateBookCopySchema } from '@studenthub/shared-schemas'

export class UpdateBookCopyDto extends createZodDto(UpdateBookCopySchema) {}
