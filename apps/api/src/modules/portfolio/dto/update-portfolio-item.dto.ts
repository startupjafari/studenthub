import { createZodDto } from 'nestjs-zod'
import { UpdatePortfolioItemSchema } from '@studenthub/shared-schemas'

export class UpdatePortfolioItemDto extends createZodDto(UpdatePortfolioItemSchema) {}
