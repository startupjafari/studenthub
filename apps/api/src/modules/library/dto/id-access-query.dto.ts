import { createZodDto } from 'nestjs-zod'
import { IdAccessQuerySchema } from '@studenthub/shared-schemas'

export class IdAccessQueryDto extends createZodDto(IdAccessQuerySchema) {}
