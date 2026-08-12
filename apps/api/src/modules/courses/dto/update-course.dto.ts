import { createZodDto } from 'nestjs-zod'
import { UpdateCourseSchema } from '@studenthub/shared-schemas'

export class UpdateCourseDto extends createZodDto(UpdateCourseSchema) {}
