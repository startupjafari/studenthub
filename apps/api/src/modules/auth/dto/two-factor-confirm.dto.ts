import { createZodDto } from 'nestjs-zod'
import { TwoFactorConfirmSchema } from '@studenthub/shared-schemas'

// Действие, подтверждённое своим вторым фактором (перевыпуск backup-кодов) — TOTP или backup-код.
export class TwoFactorConfirmDto extends createZodDto(TwoFactorConfirmSchema) {}
