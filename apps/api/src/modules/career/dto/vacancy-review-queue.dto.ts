import { createZodDto } from 'nestjs-zod'
import { VacancyReviewQueueSchema } from '@studenthub/shared-schemas'

export class VacancyReviewQueueDto extends createZodDto(VacancyReviewQueueSchema) {}
