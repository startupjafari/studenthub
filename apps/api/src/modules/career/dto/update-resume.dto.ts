import { createZodDto } from 'nestjs-zod'
import { UpdateResumeSchema } from '@studenthub/shared-schemas'

export class UpdateResumeDto extends createZodDto(UpdateResumeSchema) {}
