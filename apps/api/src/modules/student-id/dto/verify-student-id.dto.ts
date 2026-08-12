import { createZodDto } from 'nestjs-zod'
import { VerifyStudentIdSchema } from '@studenthub/shared-schemas'

export class VerifyStudentIdDto extends createZodDto(VerifyStudentIdSchema) {}
