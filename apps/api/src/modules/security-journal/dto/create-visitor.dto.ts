import { createZodDto } from 'nestjs-zod'
import { CreateVisitorSchema } from '@studenthub/shared-schemas'

export class CreateVisitorDto extends createZodDto(CreateVisitorSchema) {}
