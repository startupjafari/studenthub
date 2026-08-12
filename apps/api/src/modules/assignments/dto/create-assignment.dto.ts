import { createZodDto } from 'nestjs-zod'
import { CreateAssignmentSchema } from '@studenthub/shared-schemas'

export class CreateAssignmentDto extends createZodDto(CreateAssignmentSchema) {}
