import { createZodDto } from 'nestjs-zod'
import { CreateCampusBuildingSchema } from '@studenthub/shared-schemas'

export class CampusCreateBuildingDto extends createZodDto(CreateCampusBuildingSchema) {}
