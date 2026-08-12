import { createZodDto } from 'nestjs-zod'
import { RequestReplacementSchema } from '@studenthub/shared-schemas'

export class RequestReplacementDto extends createZodDto(RequestReplacementSchema) {}
