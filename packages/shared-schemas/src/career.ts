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

// ── Карьерный профиль студента (18.B) ────────────────────────────────────────

/**
 * Видимость карьерного профиля для работодателей.
 * По умолчанию HIDDEN: студент не должен становиться видимым компаниям молча.
 */
export const CAREER_VISIBILITIES = ['HIDDEN', 'EMPLOYERS'] as const
export const CareerVisibilitySchema = z.enum(CAREER_VISIBILITIES)
export type CareerVisibility = z.infer<typeof CareerVisibilitySchema>

export const EMPLOYMENT_STATUSES = ['LOOKING', 'OPEN', 'NOT_LOOKING'] as const
export const EmploymentStatusSchema = z.enum(EMPLOYMENT_STATUSES)
export type EmploymentStatus = z.infer<typeof EmploymentStatusSchema>

export const EMPLOYMENT_TYPES = [
  'INTERNSHIP',
  'PART_TIME',
  'FULL_TIME',
  'CONTRACT',
  'FREELANCE',
] as const
export const EmploymentTypeSchema = z.enum(EMPLOYMENT_TYPES)
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>

export const WORK_FORMATS = ['ONSITE', 'HYBRID', 'REMOTE'] as const
export const WorkFormatSchema = z.enum(WORK_FORMATS)
export type WorkFormat = z.infer<typeof WorkFormatSchema>

/**
 * Поля, которые работодателю не показываются НИКОГДА без явного согласия студента.
 * Список закрытый: добавление сюда нового поля — сознательное решение, а не побочный
 * эффект расширения выборки.
 */
export const CONSENT_FIELDS = ['GPA', 'PHONE', 'EMAIL'] as const
export const ConsentFieldSchema = z.enum(CONSENT_FIELDS)
export type ConsentField = z.infer<typeof ConsentFieldSchema>

export const UpdateCareerProfileSchema = z.object({
  visibility: CareerVisibilitySchema.optional(),
  employmentStatus: EmploymentStatusSchema.optional(),
  desiredPositions: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  employmentTypes: z.array(EmploymentTypeSchema).max(EMPLOYMENT_TYPES.length).optional(),
  workFormats: z.array(WorkFormatSchema).max(WORK_FORMATS.length).optional(),
  relocationReady: z.boolean().optional(),
  desiredSalaryMin: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  desiredSalaryMax: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  salaryCurrency: z.enum(['KZT', 'USD', 'EUR', 'RUB']).nullable().optional(),
  about: optionalText(2000),
})
export type UpdateCareerProfileInput = z.infer<typeof UpdateCareerProfileSchema>

/** Выдать или отозвать согласие. companyId не задан — согласие для всех работодателей. */
export const SetCareerConsentSchema = z.object({
  field: ConsentFieldSchema,
  granted: z.boolean(),
  companyId: z.string().uuid().optional(),
})
export type SetCareerConsentInput = z.infer<typeof SetCareerConsentSchema>

// ── Готовность профиля ───────────────────────────────────────────────────────

/**
 * Вклад разделов в готовность профиля (0–100).
 *
 * Это НЕ академический показатель и не оценка человека: только измеримая полнота
 * заполнения, чтобы студент видел, чего не хватает работодателю. Веса держим в контракте,
 * потому что тот же расчёт объясняется в интерфейсе — считать в двух местах по-разному
 * нельзя.
 */
export const READINESS_WEIGHTS = {
  /** Курс, специальность, год выпуска — приходят из профиля вуза. */
  education: 20,
  /** Навыки: полный вес от пяти и больше. */
  skills: 25,
  /** Портфолио: проекты, опыт, сертификаты, достижения. */
  portfolio: 20,
  /** Заполненный карьерный блок: чего ищет, формат, позиции. */
  preferences: 15,
  /** Рассказ о себе. */
  about: 20,
} as const

export interface ReadinessInput {
  hasEducation: boolean
  skillsCount: number
  portfolioCount: number
  hasPreferences: boolean
  aboutLength: number
}

export interface ReadinessBreakdown {
  score: number
  parts: Array<{ key: keyof typeof READINESS_WEIGHTS; earned: number; max: number }>
}

/** Детерминированный расчёт готовности — одинаковый на бэке и на фронте. */
export function careerReadiness(input: ReadinessInput): ReadinessBreakdown {
  const parts: ReadinessBreakdown['parts'] = [
    {
      key: 'education',
      max: READINESS_WEIGHTS.education,
      earned: input.hasEducation ? READINESS_WEIGHTS.education : 0,
    },
    {
      key: 'skills',
      max: READINESS_WEIGHTS.skills,
      // Пять навыков — полный вес; меньше — пропорционально, чтобы первый навык уже
      // что-то давал и человек видел движение.
      earned: Math.round(READINESS_WEIGHTS.skills * Math.min(input.skillsCount, 5) * 0.2),
    },
    {
      key: 'portfolio',
      max: READINESS_WEIGHTS.portfolio,
      earned: Math.round(READINESS_WEIGHTS.portfolio * Math.min(input.portfolioCount, 3) * (1 / 3)),
    },
    {
      key: 'preferences',
      max: READINESS_WEIGHTS.preferences,
      earned: input.hasPreferences ? READINESS_WEIGHTS.preferences : 0,
    },
    {
      key: 'about',
      max: READINESS_WEIGHTS.about,
      earned: input.aboutLength >= 120 ? READINESS_WEIGHTS.about : 0,
    },
  ]
  return { score: parts.reduce((sum, p) => sum + p.earned, 0), parts }
}
