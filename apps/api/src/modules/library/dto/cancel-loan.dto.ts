import { createZodDto } from 'nestjs-zod'
import { CancelLoanSchema } from '@studenthub/shared-schemas'

export class CancelLoanDto extends createZodDto(CancelLoanSchema) {}
