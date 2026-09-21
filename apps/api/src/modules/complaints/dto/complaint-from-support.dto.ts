import { createZodDto } from 'nestjs-zod'
import { ComplaintFromSupportSchema } from '@studenthub/shared-schemas'

export class ComplaintFromSupportDto extends createZodDto(ComplaintFromSupportSchema) {}
