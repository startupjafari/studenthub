import { createZodDto } from 'nestjs-zod'
import { CreateCompanyInviteSchema } from '@studenthub/shared-schemas'

export class CreateCompanyInviteDto extends createZodDto(CreateCompanyInviteSchema) {}
