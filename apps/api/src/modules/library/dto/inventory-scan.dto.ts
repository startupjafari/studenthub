import { createZodDto } from 'nestjs-zod'
import { InventoryScanSchema } from '@studenthub/shared-schemas'

export class InventoryScanDto extends createZodDto(InventoryScanSchema) {}
