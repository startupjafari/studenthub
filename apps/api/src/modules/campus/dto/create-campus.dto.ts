import { createZodDto } from 'nestjs-zod'
import { CreateCampusSchema } from '@studenthub/shared-schemas'

export class CampusCreateCampusDto extends createZodDto(CreateCampusSchema) {}
