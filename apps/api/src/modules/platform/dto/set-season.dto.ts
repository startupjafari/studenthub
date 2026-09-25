import { createZodDto } from 'nestjs-zod'
import { SetSeasonSchema } from '@studenthub/shared-schemas'

export class SetSeasonDto extends createZodDto(SetSeasonSchema) {}
