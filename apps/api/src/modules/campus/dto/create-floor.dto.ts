import { createZodDto } from 'nestjs-zod'
import { CreateCampusFloorSchema } from '@studenthub/shared-schemas'

export class CampusCreateFloorDto extends createZodDto(CreateCampusFloorSchema) {}
