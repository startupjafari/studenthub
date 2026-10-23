import { createZodDto } from 'nestjs-zod'
import { DocumentJournalQuerySchema } from '@studenthub/shared-schemas'

export class DocumentJournalQueryDto extends createZodDto(DocumentJournalQuerySchema) {}
