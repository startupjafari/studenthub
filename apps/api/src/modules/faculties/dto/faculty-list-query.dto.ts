import { createZodDto } from 'nestjs-zod'
import { FacultyListQuerySchema } from '@studenthub/shared-schemas'

export class FacultyListQueryDto extends createZodDto(FacultyListQuerySchema) {}
