import { createZodDto } from 'nestjs-zod'
import { RejectDemoRequestSchema } from '@studenthub/shared-schemas'

export class RejectDemoRequestDto extends createZodDto(RejectDemoRequestSchema) {}
