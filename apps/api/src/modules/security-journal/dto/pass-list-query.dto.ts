import { createZodDto } from 'nestjs-zod'
import { PassListQuerySchema } from '@studenthub/shared-schemas'

export class PassListQueryDto extends createZodDto(PassListQuerySchema) {}
