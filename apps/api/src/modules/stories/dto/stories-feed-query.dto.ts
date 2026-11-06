import { createZodDto } from 'nestjs-zod'
import { StoriesFeedQuerySchema } from '@studenthub/shared-schemas'

export class StoriesFeedQueryDto extends createZodDto(StoriesFeedQuerySchema) {}
