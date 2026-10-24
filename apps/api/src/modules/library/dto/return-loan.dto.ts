import { createZodDto } from 'nestjs-zod'
import { ReturnLoanSchema } from '@studenthub/shared-schemas'

export class ReturnLoanDto extends createZodDto(ReturnLoanSchema) {}
