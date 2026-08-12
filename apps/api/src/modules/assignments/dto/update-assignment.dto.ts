import { createZodDto } from 'nestjs-zod'
import { UpdateAssignmentSchema } from '@studenthub/shared-schemas'

export class UpdateAssignmentDto extends createZodDto(UpdateAssignmentSchema) {}
