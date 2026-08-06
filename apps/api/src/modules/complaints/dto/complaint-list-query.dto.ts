import { createZodDto } from 'nestjs-zod'
import { ComplaintListQuerySchema } from '@studenthub/shared-schemas'

export class ComplaintListQueryDto extends createZodDto(ComplaintListQuerySchema) {}
