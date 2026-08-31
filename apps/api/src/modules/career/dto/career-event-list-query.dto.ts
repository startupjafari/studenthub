import { createZodDto } from 'nestjs-zod'
import { CareerEventListQuerySchema } from '@studenthub/shared-schemas'

export class CareerEventListQueryDto extends createZodDto(CareerEventListQuerySchema) {}
