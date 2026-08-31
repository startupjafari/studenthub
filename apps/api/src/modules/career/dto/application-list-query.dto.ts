import { createZodDto } from 'nestjs-zod'
import { ApplicationListQuerySchema } from '@studenthub/shared-schemas'

export class ApplicationListQueryDto extends createZodDto(ApplicationListQuerySchema) {}
