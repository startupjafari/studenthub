import { createZodDto } from 'nestjs-zod'
import { CreateRoomSchema } from '@studenthub/shared-schemas'

export class CreateRoomDto extends createZodDto(CreateRoomSchema) {}
