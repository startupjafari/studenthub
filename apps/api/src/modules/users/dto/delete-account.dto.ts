import { createZodDto } from 'nestjs-zod'
import { DeleteAccountSchema } from '@studenthub/shared-schemas'

// Удаление своего аккаунта: текущий пароль и, при включённой 2FA, код второго фактора.
export class DeleteAccountDto extends createZodDto(DeleteAccountSchema) {}
