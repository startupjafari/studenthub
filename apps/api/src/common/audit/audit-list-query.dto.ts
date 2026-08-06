import { createZodDto } from 'nestjs-zod'
import { AuditListQuerySchema } from '@studenthub/shared-schemas'

export class AuditListQueryDto extends createZodDto(AuditListQuerySchema) {}
