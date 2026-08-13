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

// ── Массовый импорт/приглашение (CSV/XLSX) ─────────────────────────────────────
// Онбординг многих студентов сразу (docs/PROJECT.md §7). Двухшаговый поток: сервер
// парсит файл и валидирует (preview, без записи), затем создаёт инвайты по подтверждённым
// строкам. Роль и scope по-прежнему выводит сервер из токена — тело им не доверяет.

// Верхняя граница строк за один импорт (защита от гигантских загрузок).
export const BULK_INVITE_MAX_ROWS = 500

// Статус строки предпросмотра: готова к созданию / дубль (уже есть) / ошибка.
export const BulkInviteRowStatusSchema = z.enum(['READY', 'DUPLICATE', 'ERROR'])
export type BulkInviteRowStatus = z.infer<typeof BulkInviteRowStatusSchema>

// Одна строка предпросмотра: как распарсили + результат валидации.
export const BulkInvitePreviewRowSchema = z.object({
  line: z.number().int().positive(),
  email: z.string(),
  groupName: z.string(),
  role: RoleSchema,
  groupId: z.string().nullable(),
  status: BulkInviteRowStatusSchema,
  error: z.string().nullable(),
})
export type BulkInvitePreviewRow = z.infer<typeof BulkInvitePreviewRowSchema>

export const BulkInvitePreviewResponseSchema = z.object({
  rows: z.array(BulkInvitePreviewRowSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
})
export type BulkInvitePreviewResponse = z.infer<typeof BulkInvitePreviewResponseSchema>

// Подтверждение импорта: только валидные строки (groupId уже разрешён на preview).
export const BulkInviteCommitRowSchema = z
  .object({
    email: z.string().email(),
    groupId: z.string().min(1),
    role: RoleSchema.optional(),
  })
  .strict()

export const BulkInviteCommitSchema = z
  .object({
    rows: z.array(BulkInviteCommitRowSchema).min(1).max(BULK_INVITE_MAX_ROWS),
  })
  .strict()
export type BulkInviteCommitInput = z.infer<typeof BulkInviteCommitSchema>

export const BulkInviteResultSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
})
export type BulkInviteResult = z.infer<typeof BulkInviteResultSchema>
