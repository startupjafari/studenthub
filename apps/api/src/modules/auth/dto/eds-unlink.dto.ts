import { createZodDto } from 'nestjs-zod'
import { TwoFactorConfirmSchema } from '@studenthub/shared-schemas'

// Отвязка своей ЭЦП: подтверждение своим кодом 2FA (TOTP или backup).
export class EdsUnlinkDto extends createZodDto(TwoFactorConfirmSchema) {}
