import { createZodDto } from 'nestjs-zod'
import { RevokeClearanceSchema } from '@studenthub/shared-schemas'

export class RevokeClearanceDto extends createZodDto(RevokeClearanceSchema) {}
