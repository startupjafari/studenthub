import { createZodDto } from 'nestjs-zod'
import { ResetPasswordSchema } from '@studenthub/shared-schemas'

// Новый пароль по одноразовому токену из письма.
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
