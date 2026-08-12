import { createZodDto } from 'nestjs-zod'
import { AddApplicationResultSchema } from '@studenthub/shared-schemas'
export class AddResultDto extends createZodDto(AddApplicationResultSchema) {}
