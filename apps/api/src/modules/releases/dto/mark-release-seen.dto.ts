import { createZodDto } from 'nestjs-zod'
import { MarkReleaseSeenSchema } from '@studenthub/shared-schemas'

export class MarkReleaseSeenDto extends createZodDto(MarkReleaseSeenSchema) {}
