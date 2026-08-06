import { createZodDto } from 'nestjs-zod'
import { PresignProfileMediaSchema } from '@studenthub/shared-schemas'

export class PresignProfileMediaDto extends createZodDto(PresignProfileMediaSchema) {}
