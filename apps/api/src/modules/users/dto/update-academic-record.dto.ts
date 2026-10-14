import { createZodDto } from 'nestjs-zod'
import { UpdateAcademicRecordSchema } from '@studenthub/shared-schemas'

export class UpdateAcademicRecordDto extends createZodDto(UpdateAcademicRecordSchema) {}
