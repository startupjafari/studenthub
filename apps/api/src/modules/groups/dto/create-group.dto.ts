import { createZodDto } from 'nestjs-zod'
import { CreateGroupSchema } from '@studenthub/shared-schemas'

export class CreateGroupDto extends createZodDto(CreateGroupSchema) {}
