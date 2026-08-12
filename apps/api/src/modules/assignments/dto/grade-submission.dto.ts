import { createZodDto } from 'nestjs-zod'
import { GradeSubmissionSchema } from '@studenthub/shared-schemas'

export class GradeSubmissionDto extends createZodDto(GradeSubmissionSchema) {}
