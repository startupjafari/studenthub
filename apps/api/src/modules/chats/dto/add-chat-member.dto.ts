import { createZodDto } from 'nestjs-zod'
import { AddChatMemberSchema } from '@studenthub/shared-schemas'

export class AddChatMemberDto extends createZodDto(AddChatMemberSchema) {}
