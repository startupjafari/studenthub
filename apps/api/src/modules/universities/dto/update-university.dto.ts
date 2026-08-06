import { createZodDto } from 'nestjs-zod'
import { UpdateUniversitySchema } from '@studenthub/shared-schemas'

export class UpdateUniversityDto extends createZodDto(UpdateUniversitySchema) {}
