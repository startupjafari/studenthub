import { createZodDto } from 'nestjs-zod'
import { UpsertApplicationServiceSchema } from '@studenthub/shared-schemas'
export class UpsertApplicationServiceDto extends createZodDto(UpsertApplicationServiceSchema) {}
