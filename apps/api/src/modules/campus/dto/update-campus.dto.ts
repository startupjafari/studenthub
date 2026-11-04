import { createZodDto } from 'nestjs-zod'
import { UpdateCampusSchema } from '@studenthub/shared-schemas'

export class CampusUpdateCampusDto extends createZodDto(UpdateCampusSchema) {}
