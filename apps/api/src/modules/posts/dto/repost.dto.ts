import { createZodDto } from 'nestjs-zod'
import { RepostSchema } from '@studenthub/shared-schemas'

export class RepostDto extends createZodDto(RepostSchema) {}
