import { createZodDto } from 'nestjs-zod'
import { AssignmentListQuerySchema } from '@studenthub/shared-schemas'

export class AssignmentListQueryDto extends createZodDto(AssignmentListQuerySchema) {}
