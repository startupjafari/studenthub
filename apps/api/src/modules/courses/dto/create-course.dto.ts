import { createZodDto } from 'nestjs-zod'
import { CreateCourseSchema } from '@studenthub/shared-schemas'

export class CreateCourseDto extends createZodDto(CreateCourseSchema) {}
