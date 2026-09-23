import { createZodDto } from 'nestjs-zod'
import { SetMaintenanceSchema } from '@studenthub/shared-schemas'

export class SetMaintenanceDto extends createZodDto(SetMaintenanceSchema) {}
