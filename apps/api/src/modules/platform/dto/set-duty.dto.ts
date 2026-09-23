import { createZodDto } from 'nestjs-zod'
import { SetDutySchema } from '@studenthub/shared-schemas'

export class SetDutyDto extends createZodDto(SetDutySchema) {}
