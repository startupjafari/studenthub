import { createZodDto } from 'nestjs-zod'
import { QrTokenQuerySchema } from '@studenthub/shared-schemas'

export class QrTokenQueryDto extends createZodDto(QrTokenQuerySchema) {}
