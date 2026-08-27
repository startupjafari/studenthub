import { createZodDto } from 'nestjs-zod'
import { InviteListQuerySchema } from '@studenthub/shared-schemas'

export class InviteListDto extends createZodDto(InviteListQuerySchema) {}
