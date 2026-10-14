import { createZodDto } from 'nestjs-zod'
import { JoinChatByInviteSchema } from '@studenthub/shared-schemas'

export class JoinChatByInviteDto extends createZodDto(JoinChatByInviteSchema) {}
