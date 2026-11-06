import { createZodDto } from 'nestjs-zod'
import { CompanyUniversityDirectoryQuerySchema } from '@studenthub/shared-schemas'

export class CompanyUniversityDirectoryQueryDto extends createZodDto(
  CompanyUniversityDirectoryQuerySchema,
) {}
