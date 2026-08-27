import { createZodDto } from 'nestjs-zod'
import { KatoResolveQuerySchema } from '@studenthub/shared-schemas'

export class KatoResolveDto extends createZodDto(KatoResolveQuerySchema) {}
