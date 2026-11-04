import { createZodDto } from 'nestjs-zod'
import { UpdateCampusFloorSchema } from '@studenthub/shared-schemas'

export class CampusUpdateFloorDto extends createZodDto(UpdateCampusFloorSchema) {}
