import { createZodDto } from 'nestjs-zod'
import { ReturnSubmissionSchema } from '@studenthub/shared-schemas'

export class ReturnSubmissionDto extends createZodDto(ReturnSubmissionSchema) {}
