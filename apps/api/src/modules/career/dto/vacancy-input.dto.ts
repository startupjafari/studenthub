import { createZodDto } from 'nestjs-zod'
import { VacancyInputSchema } from '@studenthub/shared-schemas'

export class VacancyInputDto extends createZodDto(VacancyInputSchema) {}
