import { createZodDto } from 'nestjs-zod'
import { UpdateUniversityStatusSchema } from '@studenthub/shared-schemas'

export class UpdateUniversityStatusDto extends createZodDto(UpdateUniversityStatusSchema) {}
