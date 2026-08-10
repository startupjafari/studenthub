import { createZodDto } from 'nestjs-zod'
import { FriendsListQuerySchema } from '@studenthub/shared-schemas'

export class FriendsListQueryDto extends createZodDto(FriendsListQuerySchema) {}
