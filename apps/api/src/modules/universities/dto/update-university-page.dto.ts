import { createZodDto } from 'nestjs-zod'
import { UpdateUniversityPageSchema } from '@studenthub/shared-schemas'

export class UpdateUniversityPageDto extends createZodDto(UpdateUniversityPageSchema) {}
