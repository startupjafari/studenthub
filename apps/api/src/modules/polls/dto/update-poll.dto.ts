import { createZodDto } from 'nestjs-zod'
import { UpdatePollSchema } from '@studenthub/shared-schemas'

export class UpdatePollDto extends createZodDto(UpdatePollSchema) {}
