import { createZodDto } from 'nestjs-zod'
import { ClearChatSchema } from '@studenthub/shared-schemas'

// Очистка истории «для меня»: без полей — вся до текущего момента, с from/to — только период.
export class ClearChatDto extends createZodDto(ClearChatSchema) {}
