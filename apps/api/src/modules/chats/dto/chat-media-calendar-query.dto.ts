import { createZodDto } from 'nestjs-zod'
import { ChatMediaCalendarQuerySchema } from '@studenthub/shared-schemas'

// Снимки по дням для календаря перехода по дате (§5 карты): ?from=&to=&tzOffset=.
export class ChatMediaCalendarQueryDto extends createZodDto(ChatMediaCalendarQuerySchema) {}
