import { createZodDto } from 'nestjs-zod'
import { OpenSupportTicketSchema } from '@studenthub/shared-schemas'

export class OpenSupportTicketDto extends createZodDto(OpenSupportTicketSchema) {}
