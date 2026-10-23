import { createZodDto } from 'nestjs-zod'
import { CancelReturnSchema } from '@studenthub/shared-schemas'

export class CancelReturnDto extends createZodDto(CancelReturnSchema) {}
