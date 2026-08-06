import { createZodDto } from 'nestjs-zod'
import { SharePostSchema } from '@studenthub/shared-schemas'

export class SharePostDto extends createZodDto(SharePostSchema) {}
