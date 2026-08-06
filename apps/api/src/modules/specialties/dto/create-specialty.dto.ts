import { createZodDto } from 'nestjs-zod'
import { CreateSpecialtySchema } from '@studenthub/shared-schemas'

export class CreateSpecialtyDto extends createZodDto(CreateSpecialtySchema) {}
