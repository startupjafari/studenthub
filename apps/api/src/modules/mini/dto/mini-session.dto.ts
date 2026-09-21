import { createZodDto } from 'nestjs-zod'
import { MiniSessionSchema } from '@studenthub/shared-schemas'

export class MiniSessionDto extends createZodDto(MiniSessionSchema) {}
