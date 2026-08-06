import { createZodDto } from 'nestjs-zod'
import { RoomListQuerySchema } from '@studenthub/shared-schemas'

export class RoomListQueryDto extends createZodDto(RoomListQuerySchema) {}
