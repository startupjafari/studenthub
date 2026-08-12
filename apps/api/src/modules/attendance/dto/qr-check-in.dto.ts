import { createZodDto } from 'nestjs-zod'
import { QrCheckInSchema } from '@studenthub/shared-schemas'

export class QrCheckInDto extends createZodDto(QrCheckInSchema) {}
