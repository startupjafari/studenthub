import { createZodDto } from 'nestjs-zod'
import { BulkInviteCommitSchema } from '@studenthub/shared-schemas'

// Тело подтверждения массового импорта: строки, отобранные на предпросмотре (email/groupId/role).
export class BulkInviteCommitDto extends createZodDto(BulkInviteCommitSchema) {}
