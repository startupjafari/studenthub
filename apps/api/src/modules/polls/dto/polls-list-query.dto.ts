import { createZodDto } from 'nestjs-zod'
import { PollsListQuerySchema } from '@studenthub/shared-schemas'

export class PollsListQueryDto extends createZodDto(PollsListQuerySchema) {}
