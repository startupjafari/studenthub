import { createZodDto } from 'nestjs-zod'
import { IssueApplicationSchema } from '@studenthub/shared-schemas'
export class IssueApplicationDto extends createZodDto(IssueApplicationSchema) {}
