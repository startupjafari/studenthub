import { createZodDto } from 'nestjs-zod'
import { ChangeApplicationStatusSchema } from '@studenthub/shared-schemas'

export class ChangeApplicationStatusDto extends createZodDto(ChangeApplicationStatusSchema) {}
