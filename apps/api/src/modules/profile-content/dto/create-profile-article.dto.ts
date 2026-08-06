import { createZodDto } from 'nestjs-zod'
import { CreateProfileArticleSchema } from '@studenthub/shared-schemas'

export class CreateProfileArticleDto extends createZodDto(CreateProfileArticleSchema) {}
