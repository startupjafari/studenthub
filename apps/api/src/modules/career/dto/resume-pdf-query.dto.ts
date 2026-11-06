import { createZodDto } from 'nestjs-zod'
import { ResumePdfQuerySchema } from '@studenthub/shared-schemas'

export class ResumePdfQueryDto extends createZodDto(ResumePdfQuerySchema) {}
