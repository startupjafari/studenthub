import { createZodDto } from 'nestjs-zod'
import { FriendRequestsQuerySchema } from '@studenthub/shared-schemas'

export class FriendRequestsQueryDto extends createZodDto(FriendRequestsQuerySchema) {}
