import { createZodDto } from 'nestjs-zod'
import { RejectApplicationSchema } from '@studenthub/shared-schemas'
export class RejectApplicationDto extends createZodDto(RejectApplicationSchema) {}
