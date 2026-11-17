import { createZodDto } from 'nestjs-zod'
import { CreateMessageComplaintsSchema } from '@studenthub/shared-schemas'

export class CreateMessageComplaintsDto extends createZodDto(CreateMessageComplaintsSchema) {}
