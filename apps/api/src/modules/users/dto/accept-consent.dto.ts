import { createZodDto } from 'nestjs-zod'
import { AcceptConsentSchema } from '@studenthub/shared-schemas'

// Повторное согласие на обработку ПДн (A-F29): новая редакция документов или смена основания.
export class AcceptConsentDto extends createZodDto(AcceptConsentSchema) {}
