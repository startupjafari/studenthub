import { createZodDto } from 'nestjs-zod'
import { AuthoredRequestsQuerySchema } from '@studenthub/shared-schemas'

// Запросы в области сотрудника: без `page` — прежний массив, с `page` — страница таблицы.
export class AuthoredRequestsQueryDto extends createZodDto(AuthoredRequestsQuerySchema) {}
