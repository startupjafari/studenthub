import { createZodDto } from 'nestjs-zod'
import { ResolveReaderSchema } from '@studenthub/shared-schemas'

export class ResolveReaderDto extends createZodDto(ResolveReaderSchema) {}
