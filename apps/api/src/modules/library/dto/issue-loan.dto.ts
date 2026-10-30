import { createZodDto } from 'nestjs-zod'
import { IssueLoanSchema } from '@studenthub/shared-schemas'

export class IssueLoanDto extends createZodDto(IssueLoanSchema) {}
