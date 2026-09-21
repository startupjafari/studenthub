import { createZodDto } from 'nestjs-zod'
import { SetSectionsSchema } from '@studenthub/shared-schemas'

export class SetSectionsDto extends createZodDto(SetSectionsSchema) {}
