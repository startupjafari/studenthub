import { createZodDto } from 'nestjs-zod'
import { UpdateRoomSchema } from '@studenthub/shared-schemas'

export class UpdateRoomDto extends createZodDto(UpdateRoomSchema) {}
