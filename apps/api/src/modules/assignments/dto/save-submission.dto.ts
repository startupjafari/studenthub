import { createZodDto } from 'nestjs-zod'
import { SaveSubmissionDraftSchema } from '@studenthub/shared-schemas'

export class SaveSubmissionDto extends createZodDto(SaveSubmissionDraftSchema) {}
