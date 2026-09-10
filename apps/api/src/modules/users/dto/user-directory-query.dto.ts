import { createZodDto } from 'nestjs-zod'
import { UserDirectoryQuerySchema } from '@studenthub/shared-schemas'

export class UserDirectoryQueryDto extends createZodDto(UserDirectoryQuerySchema) {}
