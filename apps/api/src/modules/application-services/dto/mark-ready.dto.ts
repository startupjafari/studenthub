import { createZodDto } from 'nestjs-zod'
import { MarkReadySchema } from '@studenthub/shared-schemas'
export class MarkReadyDto extends createZodDto(MarkReadySchema) {}
