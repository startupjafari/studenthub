import { createZodDto } from 'nestjs-zod'
import { BlockUserSchema } from '@studenthub/shared-schemas'

export class BlockUserDto extends createZodDto(BlockUserSchema) {}
