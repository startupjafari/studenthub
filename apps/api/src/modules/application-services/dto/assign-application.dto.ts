import { createZodDto } from 'nestjs-zod'
import { AssignApplicationSchema } from '@studenthub/shared-schemas'
export class AssignApplicationDto extends createZodDto(AssignApplicationSchema) {}
