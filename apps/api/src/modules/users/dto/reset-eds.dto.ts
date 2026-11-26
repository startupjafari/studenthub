import { createZodDto } from 'nestjs-zod'
import { TwoFactorConfirmSchema } from '@studenthub/shared-schemas'

// Сброс привязки ЭЦП другому человеку: код второго фактора САМОГО администратора (TOTP или backup).
export class ResetEdsDto extends createZodDto(TwoFactorConfirmSchema) {}
