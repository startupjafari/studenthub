import { createZodDto } from 'nestjs-zod'
import { CreateInviteSchema } from '@studenthub/shared-schemas'

export class CreateInviteDto extends createZodDto(CreateInviteSchema) {}
