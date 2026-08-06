import { createZodDto } from 'nestjs-zod'
import { ResolveComplaintSchema } from '@studenthub/shared-schemas'

export class ResolveComplaintDto extends createZodDto(ResolveComplaintSchema) {}
