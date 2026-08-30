import { createZodDto } from 'nestjs-zod'
import { DecideVacancySchema } from '@studenthub/shared-schemas'

export class DecideVacancyDto extends createZodDto(DecideVacancySchema) {}
