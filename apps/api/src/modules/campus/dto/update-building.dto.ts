import { createZodDto } from 'nestjs-zod'
import { UpdateCampusBuildingSchema } from '@studenthub/shared-schemas'

export class CampusUpdateBuildingDto extends createZodDto(UpdateCampusBuildingSchema) {}
