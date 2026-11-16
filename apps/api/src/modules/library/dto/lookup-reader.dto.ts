import { createZodDto } from 'nestjs-zod'
import { LookupReaderSchema } from '@studenthub/shared-schemas'

export class LookupReaderDto extends createZodDto(LookupReaderSchema) {}
