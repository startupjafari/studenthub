import { createZodDto } from 'nestjs-zod'
import { CreatePairSchema } from '@studenthub/shared-schemas'

export class CreatePairDto extends createZodDto(CreatePairSchema) {}
