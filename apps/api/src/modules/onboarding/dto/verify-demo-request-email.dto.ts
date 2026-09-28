import { createZodDto } from 'nestjs-zod'
import { VerifyDemoRequestEmailSchema } from '@studenthub/shared-schemas'

export class VerifyDemoRequestEmailDto extends createZodDto(VerifyDemoRequestEmailSchema) {}
