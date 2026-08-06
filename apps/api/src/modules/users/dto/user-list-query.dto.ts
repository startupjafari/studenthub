import { createZodDto } from 'nestjs-zod'
import { UserListQuerySchema } from '@studenthub/shared-schemas'

export class UserListQueryDto extends createZodDto(UserListQuerySchema) {}
