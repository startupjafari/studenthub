import { createZodDto } from 'nestjs-zod'
import { ReorderPortfolioSchema } from '@studenthub/shared-schemas'

export class ReorderPortfolioDto extends createZodDto(ReorderPortfolioSchema) {}
