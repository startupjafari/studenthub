import { createZodDto } from 'nestjs-zod'
import { MiniLinkSchema } from '@studenthub/shared-schemas'

export class MiniLinkDto extends createZodDto(MiniLinkSchema) {}
