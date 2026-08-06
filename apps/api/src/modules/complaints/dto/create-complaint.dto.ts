import { createZodDto } from 'nestjs-zod'
import { CreateComplaintSchema } from '@studenthub/shared-schemas'

export class CreateComplaintDto extends createZodDto(CreateComplaintSchema) {}
