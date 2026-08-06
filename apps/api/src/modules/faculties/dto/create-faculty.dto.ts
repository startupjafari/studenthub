import { createZodDto } from 'nestjs-zod'
import { CreateFacultySchema } from '@studenthub/shared-schemas'

export class CreateFacultyDto extends createZodDto(CreateFacultySchema) {}
