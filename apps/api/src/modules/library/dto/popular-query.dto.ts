import { createZodDto } from 'nestjs-zod'
import { PopularQuerySchema } from '@studenthub/shared-schemas'

export class PopularQueryDto extends createZodDto(PopularQuerySchema) {}
