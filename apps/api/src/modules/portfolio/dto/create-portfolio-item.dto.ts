import { createZodDto } from 'nestjs-zod'
import { CreatePortfolioItemSchema } from '@studenthub/shared-schemas'

export class CreatePortfolioItemDto extends createZodDto(CreatePortfolioItemSchema) {}
