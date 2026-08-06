import { createZodDto } from 'nestjs-zod'
import { MaterialListQuerySchema } from '@studenthub/shared-schemas'

export class MaterialListQueryDto extends createZodDto(MaterialListQuerySchema) {}
