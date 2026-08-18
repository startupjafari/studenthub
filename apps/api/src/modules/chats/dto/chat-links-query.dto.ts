import { createZodDto } from 'nestjs-zod'
import { CursorPaginationSchema } from '@studenthub/shared-schemas'

// Ссылки чата (§23): cursor/limit.
export class ChatLinksQueryDto extends createZodDto(CursorPaginationSchema) {}
