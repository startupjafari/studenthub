import { createZodDto } from 'nestjs-zod'
import { ChatUpdatesQuerySchema } from '@studenthub/shared-schemas'

export class ChatUpdatesQueryDto extends createZodDto(ChatUpdatesQuerySchema) {}
