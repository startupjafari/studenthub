import { createZodDto } from 'nestjs-zod'
import { UpdateCareerProfileSchema } from '@studenthub/shared-schemas'

export class UpdateCareerProfileDto extends createZodDto(UpdateCareerProfileSchema) {}
