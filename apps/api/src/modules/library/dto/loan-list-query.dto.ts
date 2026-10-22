import { createZodDto } from 'nestjs-zod'
import { LoanListQuerySchema } from '@studenthub/shared-schemas'

export class LoanListQueryDto extends createZodDto(LoanListQuerySchema) {}
