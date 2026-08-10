import { createZodDto } from 'nestjs-zod'
import { QrApproveSchema } from '@studenthub/shared-schemas'

// Подтверждение входа по QR с залогиненного устройства.
export class QrApproveDto extends createZodDto(QrApproveSchema) {}
