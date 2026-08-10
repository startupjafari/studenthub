import { createZodDto } from 'nestjs-zod'
import { TwoFactorDisableSchema } from '@studenthub/shared-schemas'

// Отключение 2FA — TOTP или backup-код.
export class TwoFactorDisableDto extends createZodDto(TwoFactorDisableSchema) {}
