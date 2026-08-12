import { createZodDto } from 'nestjs-zod'
import { CreateGradeColumnSchema } from '@studenthub/shared-schemas'

export class CreateGradeColumnDto extends createZodDto(CreateGradeColumnSchema) {}
