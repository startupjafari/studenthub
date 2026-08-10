import { createZodDto } from 'nestjs-zod'
import { QrClaimSchema } from '@studenthub/shared-schemas'

// Забор сессии инициировавшим десктопом.
export class QrClaimDto extends createZodDto(QrClaimSchema) {}
