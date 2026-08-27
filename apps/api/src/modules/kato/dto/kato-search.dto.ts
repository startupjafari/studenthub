import { createZodDto } from 'nestjs-zod'
import { KatoSearchQuerySchema } from '@studenthub/shared-schemas'

export class KatoSearchDto extends createZodDto(KatoSearchQuerySchema) {}
