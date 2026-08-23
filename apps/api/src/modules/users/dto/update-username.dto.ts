import { createZodDto } from 'nestjs-zod'
import { UpdateUsernameSchema } from '@studenthub/shared-schemas'

export class UpdateUsernameDto extends createZodDto(UpdateUsernameSchema) {}
