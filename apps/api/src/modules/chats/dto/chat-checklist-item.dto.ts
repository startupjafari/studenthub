import { createZodDto } from 'nestjs-zod'
import {
  ChatChecklistItemAddSchema,
  ChatChecklistItemToggleSchema,
} from '@studenthub/shared-schemas'

export class ChatChecklistItemAddDto extends createZodDto(ChatChecklistItemAddSchema) {}
export class ChatChecklistItemToggleDto extends createZodDto(ChatChecklistItemToggleSchema) {}
