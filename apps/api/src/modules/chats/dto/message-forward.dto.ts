import { createZodDto } from 'nestjs-zod'
import { MessageForwardSchema } from '@studenthub/shared-schemas'

export class MessageForwardDto extends createZodDto(MessageForwardSchema) {}
