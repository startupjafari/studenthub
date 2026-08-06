import { createZodDto } from 'nestjs-zod'
import { CreateChatSchema } from '@studenthub/shared-schemas'

export class CreateChatDto extends createZodDto(CreateChatSchema) {}
