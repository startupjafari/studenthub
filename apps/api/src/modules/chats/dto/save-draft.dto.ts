import { createZodDto } from 'nestjs-zod'
import { SaveDraftSchema } from '@studenthub/shared-schemas'

export class SaveDraftDto extends createZodDto(SaveDraftSchema) {}
