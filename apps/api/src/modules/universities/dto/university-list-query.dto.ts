import { createZodDto } from 'nestjs-zod'
import { UniversityListQuerySchema } from '@studenthub/shared-schemas'

export class UniversityListQueryDto extends createZodDto(UniversityListQuerySchema) {}
