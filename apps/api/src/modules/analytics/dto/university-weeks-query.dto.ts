import { createZodDto } from 'nestjs-zod'
import { UniversityWeeksQuerySchema } from '@studenthub/shared-schemas'

export class UniversityWeeksQueryDto extends createZodDto(UniversityWeeksQuerySchema) {}
