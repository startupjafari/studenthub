import { createZodDto } from 'nestjs-zod'
import { EdsLinkSchema } from '@studenthub/shared-schemas'

// Привязка ЭЦП: подписанный challenge привязки + свой код 2FA (TOTP или backup).
export class EdsLinkDto extends createZodDto(EdsLinkSchema) {}
