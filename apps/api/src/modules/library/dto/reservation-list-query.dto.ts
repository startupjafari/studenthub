import { createZodDto } from 'nestjs-zod'
import { ReservationListQuerySchema } from '@studenthub/shared-schemas'

export class ReservationListQueryDto extends createZodDto(ReservationListQuerySchema) {}
