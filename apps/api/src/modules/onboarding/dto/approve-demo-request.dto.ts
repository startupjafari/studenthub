import { createZodDto } from 'nestjs-zod'
import { ApproveDemoRequestSchema } from '@studenthub/shared-schemas'

export class ApproveDemoRequestDto extends createZodDto(ApproveDemoRequestSchema) {}
