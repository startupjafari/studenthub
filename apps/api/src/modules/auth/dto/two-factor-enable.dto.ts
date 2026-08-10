import { createZodDto } from 'nestjs-zod'
import { TwoFactorEnableSchema } from '@studenthub/shared-schemas'

// Подтверждение подключения 2FA — TOTP-код.
export class TwoFactorEnableDto extends createZodDto(TwoFactorEnableSchema) {}
