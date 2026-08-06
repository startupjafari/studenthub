import { createZodDto } from 'nestjs-zod'
import { UpdateProfileArticleSchema } from '@studenthub/shared-schemas'

export class UpdateProfileArticleDto extends createZodDto(UpdateProfileArticleSchema) {}
