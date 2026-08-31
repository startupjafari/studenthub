import { createZodDto } from 'nestjs-zod'
import { UpdateVacancySchema } from '@studenthub/shared-schemas'

export class UpdateVacancyDto extends createZodDto(UpdateVacancySchema) {}
