import { createZodDto } from 'nestjs-zod'
import { UpdateGroupSchema } from '@studenthub/shared-schemas'

export class UpdateGroupDto extends createZodDto(UpdateGroupSchema) {}
