import { createZodDto } from 'nestjs-zod'
import { MaterialListQuerySchema, MaterialSubjectsQuerySchema } from '@studenthub/shared-schemas'

export class MaterialListQueryDto extends createZodDto(MaterialListQuerySchema) {}

export class MaterialSubjectsQueryDto extends createZodDto(MaterialSubjectsQuerySchema) {}
