import { createZodDto } from 'nestjs-zod'
import { ConsultationMineQuerySchema } from '@studenthub/shared-schemas'

export class ConsultationMineQueryDto extends createZodDto(ConsultationMineQuerySchema) {}
