import { createZodDto } from 'nestjs-zod'
import { UpdateSpecialtySchema } from '@studenthub/shared-schemas'

export class UpdateSpecialtyDto extends createZodDto(UpdateSpecialtySchema) {}
