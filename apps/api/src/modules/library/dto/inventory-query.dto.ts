import { createZodDto } from 'nestjs-zod'
import { InventoryQuerySchema } from '@studenthub/shared-schemas'

export class InventoryQueryDto extends createZodDto(InventoryQuerySchema) {}
