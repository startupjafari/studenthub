import { createZodDto } from 'nestjs-zod'
import { AnnounceReleaseSchema } from '@studenthub/shared-schemas'

export class AnnounceReleaseDto extends createZodDto(AnnounceReleaseSchema) {}
