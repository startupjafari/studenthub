import { createZodDto } from 'nestjs-zod'
import { OffsetPaginationSchema } from '@studenthub/shared-schemas'

export class OffsetPaginationDto extends createZodDto(OffsetPaginationSchema) {}
