import { createZodDto } from 'nestjs-zod'
import { UpdateCompanySchema } from '@studenthub/shared-schemas'

export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}
