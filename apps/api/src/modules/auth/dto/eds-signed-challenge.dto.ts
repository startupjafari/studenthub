import { createZodDto } from 'nestjs-zod'
import { EdsSignedChallengeSchema } from '@studenthub/shared-schemas'

// Вход по ЭЦП: id выданного challenge + открепленная CMS-подпись его nonce (base64).
export class EdsSignedChallengeDto extends createZodDto(EdsSignedChallengeSchema) {}
