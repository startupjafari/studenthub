import { createZodDto } from 'nestjs-zod'
import { CreateTermSchema } from '@studenthub/shared-schemas'

export class CreateTermDto extends createZodDto(CreateTermSchema) {}
