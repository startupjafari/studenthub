import { createZodDto } from 'nestjs-zod'
import { VacancySearchSchema } from '@studenthub/shared-schemas'

export class VacancySearchDto extends createZodDto(VacancySearchSchema) {}
