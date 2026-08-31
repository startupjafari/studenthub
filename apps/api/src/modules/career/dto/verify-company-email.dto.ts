import { createZodDto } from 'nestjs-zod'
import { VerifyCompanyEmailSchema } from '@studenthub/shared-schemas'

export class VerifyCompanyEmailDto extends createZodDto(VerifyCompanyEmailSchema) {}
