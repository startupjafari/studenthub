import { createZodDto } from 'nestjs-zod'
import { ChatMediaPositionQuerySchema } from '@studenthub/shared-schemas'

export class ChatMediaPositionQueryDto extends createZodDto(ChatMediaPositionQuerySchema) {}
