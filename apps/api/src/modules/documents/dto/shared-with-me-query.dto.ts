import { createZodDto } from 'nestjs-zod'
import { SharedWithMeQuerySchema } from '@studenthub/shared-schemas'

// Раздел «Открытые мне»: страница по номеру (limit ≤ 100) и сортировка по колонкам таблицы.
export class SharedWithMeQueryDto extends createZodDto(SharedWithMeQuerySchema) {}
