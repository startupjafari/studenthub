import { createZodDto } from 'nestjs-zod'
import { CursorPaginationSchema } from '@studenthub/shared-schemas'

// Комплекты запроса у сотрудника: cursor-пагинация по id комплекта, limit ≤ 50.
export class SubmissionsQueryDto extends createZodDto(CursorPaginationSchema) {}
