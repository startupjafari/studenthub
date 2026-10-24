import { createZodDto } from 'nestjs-zod'
import { RenewLoanSchema } from '@studenthub/shared-schemas'

export class RenewLoanDto extends createZodDto(RenewLoanSchema) {}
