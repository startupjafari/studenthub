import { createZodDto } from 'nestjs-zod'
import { ChangePasswordSchema } from '@studenthub/shared-schemas'

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
