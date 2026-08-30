import { z } from 'zod'
import { OffsetPaginationSchema, SortOrderSchema } from './pagination.js'

// Карьера (Фаза 18): компании-работодатели и их допуск к студентам вузов.
// Единый источник истины для валидации на бэке и типов на фронте — дублировать
// списки статусов в web запрещено (FRONTEND_RULES §15.5).

// ── Статусы ──────────────────────────────────────────────────────────────────

/**
 * Платформенный статус компании. Отдельный от допусков вузов:
 * пока email не подтверждён — компанию не видит никто, включая вузы;
 * BLOCKED ставит платформа, и он перекрывает любые выданные допуски.
 */
export const COMPANY_STATUSES = ['PENDING_EMAIL', 'ACTIVE', 'BLOCKED'] as const
export const CompanyStatusSchema = z.enum(COMPANY_STATUSES)
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>

/** Роль человека внутри компании. OWNER подаёт заявки в вузы и управляет составом. */
export const COMPANY_MEMBER_ROLES = ['OWNER', 'RECRUITER'] as const
export const CompanyMemberRoleSchema = z.enum(COMPANY_MEMBER_ROLES)
export type CompanyMemberRole = z.infer<typeof CompanyMemberRoleSchema>

/**
 * Состояние допуска компании к студентам вуза.
 * REJECTED — отказ по заявке, REVOKED — отзыв ранее выданного допуска.
 * Разделены намеренно: вузу важно видеть, был ли доступ и отозван или не выдавался вовсе.
 */
export const COMPANY_ACCESS_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED'] as const
export const CompanyAccessStatusSchema = z.enum(COMPANY_ACCESS_STATUSES)
export type CompanyAccessStatus = z.infer<typeof CompanyAccessStatusSchema>

/**
 * Разрешённые переходы. Держим здесь, а не в сервисе: и API, и UI должны одинаково
 * понимать, какие кнопки показывать. Из REQUESTED — решение вуза; выданный допуск можно
 * отозвать; отозванный или отклонённый — рассмотреть заново, если компания обратилась
 * повторно (запись одна на пару «компания ↔ вуз», новой не создаётся).
 */
export const COMPANY_ACCESS_TRANSITIONS: Record<
  CompanyAccessStatus,
  readonly CompanyAccessStatus[]
> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['REVOKED'],
  REJECTED: ['REQUESTED'],
  REVOKED: ['REQUESTED'],
}

export function canTransitionAccess(from: CompanyAccessStatus, to: CompanyAccessStatus): boolean {
  return COMPANY_ACCESS_TRANSITIONS[from].includes(to)
}

/** Допуск действует: одобрен и срок не истёк. Одна функция на бэк и фронт — иначе разъедутся. */
export function isAccessActive(
  access: { status: CompanyAccessStatus; expiresAt?: string | Date | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!access || access.status !== 'APPROVED') return false
  if (!access.expiresAt) return true
  return new Date(access.expiresAt).getTime() > now.getTime()
}

// ── Поля ─────────────────────────────────────────────────────────────────────

/**
 * Необязательное текстовое поле формы: пустой input приходит как `''`, и на
 * `.min(1).optional()` это давало молчаливый отказ валидации (см. rooms.ts).
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))

/** Slug компании: только строчная латиница, цифры и дефис — попадает в публичный URL. */
export const CompanySlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Только строчная латиница, цифры и дефис')

export const CompanyNameSchema = z.string().trim().min(2).max(120)

/** Сайт компании: только http(s) — ссылку показываем студенту, javascript: недопустим. */
export const CompanyWebsiteSchema = z
  .string()
  .trim()
  .max(200)
  .url()
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), 'Ссылка должна быть http(s)')
  .optional()
  .or(z.literal('').transform(() => undefined))

// ── Регистрация работодателя ─────────────────────────────────────────────────

/**
 * Самостоятельная регистрация работодателя — единственный публичный эндпоинт платформы,
 * создающий пользователя без инвайта (решение по §3 спеки Career). Аккаунт создаётся
 * с НУЛЕВЫМ доступом: до подтверждения email и одобрения хотя бы одним вузом он не видит
 * ни одного студента.
 */
export const EmployerSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(8).max(72),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  companyName: CompanyNameSchema,
  website: CompanyWebsiteSchema,
})
export type EmployerSignupInput = z.infer<typeof EmployerSignupSchema>

export const VerifyCompanyEmailSchema = z.object({
  token: z.string().min(16).max(200),
})
export type VerifyCompanyEmailInput = z.infer<typeof VerifyCompanyEmailSchema>

// ── Профиль компании ─────────────────────────────────────────────────────────

export const UpdateCompanySchema = z.object({
  name: CompanyNameSchema.optional(),
  description: optionalText(2000),
  website: CompanyWebsiteSchema,
  city: optionalText(24),
  logoUrl: optionalText(500),
})
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>

// ── Допуск к вузу ────────────────────────────────────────────────────────────

/** Заявка компании в вуз. Сообщение необязательно, но вузу без него труднее решать. */
export const RequestCompanyAccessSchema = z.object({
  universityId: z.string().uuid(),
  message: optionalText(1000),
})
export type RequestCompanyAccessInput = z.infer<typeof RequestCompanyAccessSchema>

/**
 * Решение вуза по заявке. reason обязателен при отказе и отзыве: компания должна понимать,
 * что произошло, иначе поддержка вуза будет разбирать это письмами.
 */
export const DecideCompanyAccessSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED', 'REVOKED']),
    reason: optionalText(1000),
    /** Срок действия допуска; не задан — бессрочно. */
    expiresAt: z.string().datetime().optional(),
  })
  .refine((v) => v.status === 'APPROVED' || !!v.reason, {
    message: 'Укажите причину',
    path: ['reason'],
  })
export type DecideCompanyAccessInput = z.infer<typeof DecideCompanyAccessSchema>

// ── Списки ───────────────────────────────────────────────────────────────────

export const COMPANY_SORTS = ['name', 'createdAt', 'status'] as const
export const CompanySortSchema = z.enum(COMPANY_SORTS)
export type CompanySort = z.infer<typeof CompanySortSchema>

/** Список компаний для вуза: очередь заявок и уже допущенные. */
export const CompanyListQuerySchema = OffsetPaginationSchema.extend({
  status: CompanyAccessStatusSchema.optional(),
  search: optionalText(120),
  sort: CompanySortSchema.default('createdAt'),
  order: SortOrderSchema.default('desc'),
})
export type CompanyListQueryInput = z.infer<typeof CompanyListQuerySchema>
