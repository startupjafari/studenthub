import { createZodDto } from 'nestjs-zod'
import { CreateUniversitySchema } from '@studenthub/shared-schemas'

export class CreateUniversityDto extends createZodDto(CreateUniversitySchema) {}
