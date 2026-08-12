import { createZodDto } from 'nestjs-zod'
import { CourseListQuerySchema } from '@studenthub/shared-schemas'

export class CourseListQueryDto extends createZodDto(CourseListQuerySchema) {}
