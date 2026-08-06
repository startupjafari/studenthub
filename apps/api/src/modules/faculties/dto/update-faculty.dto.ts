import { createZodDto } from 'nestjs-zod'
import { UpdateFacultySchema } from '@studenthub/shared-schemas'

export class UpdateFacultyDto extends createZodDto(UpdateFacultySchema) {}
