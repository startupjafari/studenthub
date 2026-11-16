import { createZodDto } from 'nestjs-zod'
import { ClearanceListQuerySchema } from '@studenthub/shared-schemas'

export class ClearanceListQueryDto extends createZodDto(ClearanceListQuerySchema) {}
