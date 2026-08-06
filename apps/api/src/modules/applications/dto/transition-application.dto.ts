import { createZodDto } from 'nestjs-zod'
import { TransitionApplicationSchema } from '@studenthub/shared-schemas'

export class TransitionApplicationDto extends createZodDto(TransitionApplicationSchema) {}
