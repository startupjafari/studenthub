import { createZodDto } from 'nestjs-zod'
import { ShareStorySchema } from '@studenthub/shared-schemas'

export class ShareStoryDto extends createZodDto(ShareStorySchema) {}
