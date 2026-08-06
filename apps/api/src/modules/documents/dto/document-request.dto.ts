import { createZodDto } from 'nestjs-zod'
import {
  CreateDocumentRequestSchema,
  ReviewSubmissionItemSchema,
  SaveSubmissionSchema,
} from '@studenthub/shared-schemas'

export class CreateDocumentRequestDto extends createZodDto(CreateDocumentRequestSchema) {}
export class SaveSubmissionDto extends createZodDto(SaveSubmissionSchema) {}
export class ReviewSubmissionItemDto extends createZodDto(ReviewSubmissionItemSchema) {}
