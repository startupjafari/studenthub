import { createZodDto } from 'nestjs-zod'
import { VotePollSchema } from '@studenthub/shared-schemas'

export class VotePollDto extends createZodDto(VotePollSchema) {}
