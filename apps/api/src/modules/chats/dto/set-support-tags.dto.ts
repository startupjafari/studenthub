import { createZodDto } from 'nestjs-zod'
import { SetSupportTagsSchema } from '@studenthub/shared-schemas'

export class SetSupportTagsDto extends createZodDto(SetSupportTagsSchema) {}
