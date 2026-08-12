import { createZodDto } from 'nestjs-zod'
import { SearchQuerySchema } from '@studenthub/shared-schemas'

export class SearchQueryDto extends createZodDto(SearchQuerySchema) {}
