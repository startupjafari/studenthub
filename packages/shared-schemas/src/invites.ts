import { z } from 'zod'
import { Role } from '@studenthub/shared-types'

// Роль как Zod-схема (Role — const-объект, не TS-enum).
export const RoleSchema = z.enum(Object.values(Role) as [Role, ...Role[]])

// Создание инвайта (docs/BACKEND_RULES.md §3, §7). Роль и scope в теле — это ЗАПРОС;
// фактический scope инвайта сервер выводит из иерархии и токена создателя, не доверяя телу слепо.
export const CreateInviteSchema = z
  .object({
    role: RoleSchema,
    email: z.string().email().optional(),
    universityId: z.string().min(1).optional(),
    facultyId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
  })
  .strict()

export type CreateInviteInput = z.infer<typeof CreateInviteSchema>
