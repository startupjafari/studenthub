import { createZodDto } from 'nestjs-zod'
import { CreateMaterialSchema } from '@studenthub/shared-schemas'

export class CreateMaterialDto extends createZodDto(CreateMaterialSchema) {}
