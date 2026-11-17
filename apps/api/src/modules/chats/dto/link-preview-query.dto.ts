import { createZodDto } from 'nestjs-zod'
import { LinkPreviewQuerySchema } from '@studenthub/shared-schemas'

export class LinkPreviewQueryDto extends createZodDto(LinkPreviewQuerySchema) {}
