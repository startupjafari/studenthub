import { createZodDto } from 'nestjs-zod'
import { CreateDraftSchema } from '@studenthub/shared-schemas'

export class CreateDraftDto extends createZodDto(CreateDraftSchema) {}
