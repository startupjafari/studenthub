import { createZodDto } from 'nestjs-zod'
import { UpdatePairSchema } from '@studenthub/shared-schemas'

export class UpdatePairDto extends createZodDto(UpdatePairSchema) {}
