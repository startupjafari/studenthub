import { createZodDto } from 'nestjs-zod'
import { AcceptCompanyInviteSchema } from '@studenthub/shared-schemas'

export class AcceptCompanyInviteDto extends createZodDto(AcceptCompanyInviteSchema) {}
