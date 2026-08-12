import { createZodDto } from 'nestjs-zod'
import { RequestCorrectionSchema } from '@studenthub/shared-schemas'
export class RequestCorrectionDto extends createZodDto(RequestCorrectionSchema) {}
