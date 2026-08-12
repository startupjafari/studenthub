import { createZodDto } from 'nestjs-zod'
import { SlotListQuerySchema } from '@studenthub/shared-schemas'

export class SlotListQueryDto extends createZodDto(SlotListQuerySchema) {}
