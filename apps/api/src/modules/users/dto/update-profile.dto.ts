import { createZodDto } from 'nestjs-zod'
import { UpdateProfileSchema } from '@studenthub/shared-schemas'

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
