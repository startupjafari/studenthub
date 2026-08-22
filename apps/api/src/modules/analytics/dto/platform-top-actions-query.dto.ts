import { createZodDto } from 'nestjs-zod'
import { PlatformTopActionsQuerySchema } from '@studenthub/shared-schemas'

export class PlatformTopActionsQueryDto extends createZodDto(PlatformTopActionsQuerySchema) {}
