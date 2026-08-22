import { createZodDto } from 'nestjs-zod'
import { PlatformRangeQuerySchema } from '@studenthub/shared-schemas'

export class PlatformRangeQueryDto extends createZodDto(PlatformRangeQuerySchema) {}
