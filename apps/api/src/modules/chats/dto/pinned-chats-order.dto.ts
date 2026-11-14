import { createZodDto } from 'nestjs-zod'
import { PinnedChatsOrderSchema } from '@studenthub/shared-schemas'

export class PinnedChatsOrderDto extends createZodDto(PinnedChatsOrderSchema) {}
