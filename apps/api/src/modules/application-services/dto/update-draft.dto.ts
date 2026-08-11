import { createZodDto } from 'nestjs-zod'
import { UpdateDraftSchema } from '@studenthub/shared-schemas'

export class UpdateDraftDto extends createZodDto(UpdateDraftSchema) {}
