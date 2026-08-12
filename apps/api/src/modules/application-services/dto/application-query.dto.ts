import { createZodDto } from 'nestjs-zod'
import { ApplicationQuerySchema } from '@studenthub/shared-schemas'

export class ApplicationQueryDto extends createZodDto(ApplicationQuerySchema) {}
