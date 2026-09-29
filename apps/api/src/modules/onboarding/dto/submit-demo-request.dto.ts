import { createZodDto } from 'nestjs-zod'
import { SubmitDemoRequestSchema } from '@studenthub/shared-schemas'

export class SubmitDemoRequestDto extends createZodDto(SubmitDemoRequestSchema) {}
