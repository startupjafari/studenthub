import { createZodDto } from 'nestjs-zod'
import { TwoFactorConfirmSchema } from '@studenthub/shared-schemas'

// Сброс 2FA другому человеку: код второго фактора САМОГО администратора (TOTP или backup).
export class ResetTwoFactorDto extends createZodDto(TwoFactorConfirmSchema) {}
