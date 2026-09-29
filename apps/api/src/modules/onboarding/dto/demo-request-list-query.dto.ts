import { createZodDto } from 'nestjs-zod'
import { DemoRequestListQuerySchema } from '@studenthub/shared-schemas'

export class DemoRequestListQueryDto extends createZodDto(DemoRequestListQuerySchema) {}
