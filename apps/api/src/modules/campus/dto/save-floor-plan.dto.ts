import { createZodDto } from 'nestjs-zod'
import { SaveCampusFloorPlanSchema } from '@studenthub/shared-schemas'

export class CampusSaveFloorPlanDto extends createZodDto(SaveCampusFloorPlanSchema) {}
