import { createZodDto } from 'nestjs-zod'
import { MessageForwardBatchSchema } from '@studenthub/shared-schemas'

export class MessageForwardBatchDto extends createZodDto(MessageForwardBatchSchema) {}
