import { createZodDto } from 'nestjs-zod'
import { ReactionSchema } from '@studenthub/shared-schemas'

export class ReactionDto extends createZodDto(ReactionSchema) {}
