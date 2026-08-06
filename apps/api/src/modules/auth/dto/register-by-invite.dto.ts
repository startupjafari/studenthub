import { createZodDto } from 'nestjs-zod'
import { RegisterByInviteSchema } from '@studenthub/shared-schemas'

export class RegisterByInviteDto extends createZodDto(RegisterByInviteSchema) {}
