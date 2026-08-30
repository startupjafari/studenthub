import { createZodDto } from 'nestjs-zod'
import { CompanyListQuerySchema } from '@studenthub/shared-schemas'

export class CompanyListQueryDto extends createZodDto(CompanyListQuerySchema) {}
