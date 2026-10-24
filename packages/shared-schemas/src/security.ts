import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Журналы поста охраны (docs/PROJECT.md §3.12): посетители и проходы студентов. Ведёт
// охрана своего вуза, смотрит админ вуза; хранятся год (docs/PERSONAL_DATA.md §4).

/** Документ посетителя. Зеркало enum VisitorDocumentType в Prisma. */
export const VISITOR_DOCUMENT_TYPES = ['ID_CARD', 'PASSPORT', 'DRIVER_LICENSE', 'OTHER'] as const
export const VisitorDocumentTypeSchema = z.enum(VISITOR_DOCUMENT_TYPES)
export type VisitorDocumentTypeValue = z.infer<typeof VisitorDocumentTypeSchema>

/** Почему студента не пропустили. Зеркало enum PassDenyReason в Prisma. */
export const PASS_DENY_REASONS = [
  'STATUS',
  'BLOCKED',
  'OTHER_UNIVERSITY',
  'INVALID_QR',
  'EXPIRED_QR',
  'REUSED_QR',
] as const
export const PassDenyReasonSchema = z.enum(PASS_DENY_REASONS)
export type PassDenyReasonValue = z.infer<typeof PassDenyReasonSchema>

const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

/**
 * Запись посетителя на входе. Состав полей — решение владельца: документ — только тип и
 * четыре последние цифры (полный номер и ИИН не принимаются вовсе), телефон — по желанию.
 */
export const CreateVisitorSchema = z
  .object({
    fullName: z.string().trim().min(2).max(150),
    purpose: z.string().trim().min(2).max(300),
    documentType: VisitorDocumentTypeSchema.optional(),
    documentLast4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Четыре последние цифры документа')
      .optional(),
    // Телефон Казахстана в том виде, в каком его набирает маска поля: +7 (777) 777-77-77.
    phone: optionalText(20).refine(
      (v) => v === undefined || /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(v),
      {
        message: 'Телефон в формате +7 (777) 777-77-77',
      },
    ),
  })
  .strict()
  .refine((v) => !v.documentLast4 || v.documentType, {
    message: 'Укажите тип документа',
    path: ['documentType'],
  })
export type CreateVisitorInput = z.infer<typeof CreateVisitorSchema>

/** Журнал посетителей: `inside` — кто ещё в здании (выход не отмечен). */
export const VisitorListQuerySchema = OffsetPaginationSchema.extend({
  status: z.enum(['inside', 'all']).default('all'),
  /** День входа по часам вуза. */
  date: LocalDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
})
export type VisitorListQueryInput = z.infer<typeof VisitorListQuerySchema>

/** Журнал проходов студентов. */
export const PassListQuerySchema = OffsetPaginationSchema.extend({
  /** День прохода по часам вуза. */
  date: LocalDateSchema.optional(),
  allowed: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  q: z.string().trim().max(100).optional(),
})
export type PassListQueryInput = z.infer<typeof PassListQuerySchema>

export interface VisitorItem {
  id: string
  fullName: string
  purpose: string
  documentType: VisitorDocumentTypeValue | null
  documentLast4: string | null
  phone: string | null
  enteredAt: string
  exitedAt: string | null
  createdByName: string
}

export interface PassItem {
  id: string
  createdAt: string
  allowed: boolean
  denyReason: PassDenyReasonValue | null
  /** Пусто, если код недействителен или студент чужого вуза. */
  student: { id: string | null; name: string; group: string | null } | null
  guardName: string
}

/** Сводка поста за день по часам вуза. */
export interface SecuritySummary {
  date: string
  passes: { total: number; allowed: number; denied: number }
  visitors: { today: number; inside: number }
}

/** Решение о проходе в ответе проверки студенческого — только охране. */
export interface EntryDecision {
  allowed: boolean
  denyReason: PassDenyReasonValue | null
}
