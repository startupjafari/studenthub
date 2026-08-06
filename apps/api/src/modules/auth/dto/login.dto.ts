import { createZodDto } from 'nestjs-zod'
import { LoginSchema } from '@studenthub/shared-schemas'

// DTO логина из общей Zod-схемы (docs/BACKEND_RULES.md §3).
export class LoginDto extends createZodDto(LoginSchema) {}
