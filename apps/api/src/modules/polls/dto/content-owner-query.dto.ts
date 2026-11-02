import { createZodDto } from 'nestjs-zod'
import { ContentOwnerQuerySchema } from '@studenthub/shared-schemas'

export class ContentOwnerQueryDto extends createZodDto(ContentOwnerQuerySchema) {}
