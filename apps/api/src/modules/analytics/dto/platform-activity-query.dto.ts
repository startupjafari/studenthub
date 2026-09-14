import { createZodDto } from 'nestjs-zod'
import { PlatformActivityQuerySchema } from '@studenthub/shared-schemas'

export class PlatformActivityQueryDto extends createZodDto(PlatformActivityQuerySchema) {}
