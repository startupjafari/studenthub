import { createZodDto } from 'nestjs-zod'
import { CursorPaginationSchema } from '@studenthub/shared-schemas'

// Раздел «Открытые мне»: cursor-пагинация по id гранта, limit ≤ 50.
export class SharedWithMeQueryDto extends createZodDto(CursorPaginationSchema) {}
