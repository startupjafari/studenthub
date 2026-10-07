import { createZodDto } from 'nestjs-zod'
import { ClientVersionQuerySchema } from '@studenthub/shared-schemas'

// Платформа клиента: единственный параметр запроса.
export class ClientVersionQueryDto extends createZodDto(ClientVersionQuerySchema) {}
