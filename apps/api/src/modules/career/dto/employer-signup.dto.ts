import { createZodDto } from 'nestjs-zod'
import { EmployerSignupSchema } from '@studenthub/shared-schemas'

export class EmployerSignupDto extends createZodDto(EmployerSignupSchema) {}
