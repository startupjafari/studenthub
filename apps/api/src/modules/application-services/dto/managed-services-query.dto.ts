import { createZodDto } from 'nestjs-zod'
import { ManagedServicesQuerySchema } from '@studenthub/shared-schemas'
export class ManagedServicesQueryDto extends createZodDto(ManagedServicesQuerySchema) {}
