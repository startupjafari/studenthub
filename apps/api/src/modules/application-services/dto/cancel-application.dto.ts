import { createZodDto } from 'nestjs-zod'
import { CancelApplicationSchema } from '@studenthub/shared-schemas'

export class CancelApplicationDto extends createZodDto(CancelApplicationSchema) {}
