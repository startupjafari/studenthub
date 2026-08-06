import { createZodDto } from 'nestjs-zod'
import { EditChatSchema } from '@studenthub/shared-schemas'

export class EditChatDto extends createZodDto(EditChatSchema) {}
