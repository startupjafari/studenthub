import { createZodDto } from 'nestjs-zod'
import { UpdateGradeColumnSchema } from '@studenthub/shared-schemas'

export class UpdateGradeColumnDto extends createZodDto(UpdateGradeColumnSchema) {}
