import { createZodDto } from 'nestjs-zod'
import { SaveCampusSitePlanSchema } from '@studenthub/shared-schemas'

export class CampusSaveSitePlanDto extends createZodDto(SaveCampusSitePlanSchema) {}
