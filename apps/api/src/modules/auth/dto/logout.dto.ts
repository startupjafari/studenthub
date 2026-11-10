import { createZodDto } from 'nestjs-zod'
import { LogoutSchema } from '@studenthub/shared-schemas'

// Выход; необязательный токен пушей устройства отвязывается вместе с сессией.
export class LogoutDto extends createZodDto(LogoutSchema) {}
