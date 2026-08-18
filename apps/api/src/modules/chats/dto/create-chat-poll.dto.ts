import { createZodDto } from 'nestjs-zod'
import { CreateChatPollSchema } from '@studenthub/shared-schemas'

// Создание опроса в чате (§38): вопрос + 2..10 вариантов + настройки.
export class CreateChatPollDto extends createZodDto(CreateChatPollSchema) {}
