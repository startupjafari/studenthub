import { createZodDto } from 'nestjs-zod'
import { TwoFactorVerifySchema } from '@studenthub/shared-schemas'

// Второй шаг входа: challenge + код (TOTP или backup).
export class TwoFactorVerifyDto extends createZodDto(TwoFactorVerifySchema) {}
