import { createZodDto } from 'nestjs-zod'
import { VisitorListQuerySchema } from '@studenthub/shared-schemas'

export class VisitorListQueryDto extends createZodDto(VisitorListQuerySchema) {}
