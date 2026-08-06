import { createZodDto } from 'nestjs-zod'
import { GroupListQuerySchema } from '@studenthub/shared-schemas'

export class GroupListQueryDto extends createZodDto(GroupListQuerySchema) {}
