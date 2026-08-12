import { createZodDto } from 'nestjs-zod'
import { UpdateTermSchema } from '@studenthub/shared-schemas'

export class UpdateTermDto extends createZodDto(UpdateTermSchema) {}
