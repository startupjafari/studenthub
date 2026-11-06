import { createZodDto } from 'nestjs-zod'
import { ProfileArticlesQuerySchema } from '@studenthub/shared-schemas'

export class ProfileArticlesQueryDto extends createZodDto(ProfileArticlesQuerySchema) {}
