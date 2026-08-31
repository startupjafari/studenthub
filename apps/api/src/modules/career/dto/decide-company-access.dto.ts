import { createZodDto } from 'nestjs-zod'
import { DecideCompanyAccessSchema } from '@studenthub/shared-schemas'

export class DecideCompanyAccessDto extends createZodDto(DecideCompanyAccessSchema) {}
