import { createZodDto } from 'nestjs-zod'
import { CreatePollSchema } from '@studenthub/shared-schemas'

export class CreatePollDto extends createZodDto(CreatePollSchema) {}
