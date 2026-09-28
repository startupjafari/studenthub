import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Приход вуза на платформу (docs/PROJECT.md §31): заявка с публичной формы, решение
// модератора платформы и мастер первичной настройки.

// ── Заявка на тестирование ───────────────────────────────────────────────────

export const DemoRequestStatusSchema = z.enum(['PENDING_EMAIL', 'NEW', 'APPROVED', 'REJECTED'])
export type DemoRequestStatusValue = z.infer<typeof DemoRequestStatusSchema>

export const DemoRejectionReasonSchema = z.enum([
  'NOT_ELIGIBLE',
  'DUPLICATE',
  'INSUFFICIENT_INFO',
  'NO_CAPACITY',
  'OTHER',
])
export type DemoRejectionReasonValue = z.infer<typeof DemoRejectionReasonSchema>

/**
 * Версия текста согласия на обработку персональных данных.
 *
 * Лежит рядом со схемой формы, а не в базе: текст согласия — часть того, что показано
 * человеку, и меняется вместе с формой. Каждая поданная заявка запоминает версию, с
 * которой согласились, — иначе на вопрос «с чем именно» ответить нечем.
 *
 * Поднимать при ЛЮБОМ изменении текста согласия в `apps/web`.
 */
export const CONSENT_VERSION = '2026-09-28'

/**
 * Публичная форма заявки. Единственная на платформе схема, которую заполняет человек
 * без аккаунта и вне вуза, — поэтому пределы длин здесь жёстче обычных: всё, что
 * приходит снаружи, попадает в очередь к живому модератору.
 *
 * Пароля здесь нет намеренно, в отличие от регистрации работодателя. Заявка не создаёт
 * ни аккаунта, ни вуза: доступ выдаётся потом приглашением, как всем на платформе.
 */
export const SubmitDemoRequestSchema = z
  .object({
    universityName: z.string().trim().min(3).max(200),
    city: z.string().trim().min(1).max(100).optional(),
    country: z.string().trim().min(1).max(100).optional(),
    website: z.string().trim().url().max(200).optional(),
    /**
     * Порядок величины, а не точное число: точного не знает и сам заявитель, а нам оно
     * нужно, только чтобы понимать масштаб стенда.
     */
    studentsEstimate: z.coerce.number().int().min(1).max(1_000_000).optional(),

    contactName: z.string().trim().min(2).max(120),
    contactRole: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(160),
    phone: z.string().trim().min(5).max(32).optional(),
    comment: z.string().trim().max(2000).optional(),

    /**
     * Согласие на обработку персональных данных. Снятая галочка — это не «значение
     * false», это незаполненная форма, и отвечать на неё должна ошибка валидации, а не
     * молчаливое сохранение.
     *
     * `boolean().refine`, а не `literal(true)`: тип поля остаётся `boolean`, и форма
     * снимает галочку обычным `false` без приведения типов. У литерала тип поля — сама
     * единица `true`, и каждое снятие галочки пришлось бы кастовать.
     */
    consent: z.boolean().refine((value) => value, { message: 'Требуется согласие' }),
  })
  .strict()
export type SubmitDemoRequestInput = z.infer<typeof SubmitDemoRequestSchema>

export const VerifyDemoRequestEmailSchema = z
  .object({ token: z.string().min(16).max(200) })
  .strict()
export type VerifyDemoRequestEmailInput = z.infer<typeof VerifyDemoRequestEmailSchema>

// ── Очередь модерации ────────────────────────────────────────────────────────

export const DemoRequestListQuerySchema = OffsetPaginationSchema.extend({
  status: DemoRequestStatusSchema.optional(),
  search: z.string().trim().min(2).max(100).optional(),
})
export type DemoRequestListQueryInput = z.infer<typeof DemoRequestListQuerySchema>

/**
 * Одобрение. Реквизиты вуза здесь можно поправить: в форме их писал человек снаружи,
 * и «КазНУ» вместо полного названия — обычное дело. Что не редактируется — адрес
 * приглашения: он должен остаться тем, который подтвердили письмом.
 */
export const ApproveDemoRequestSchema = z
  .object({
    name: z.string().trim().min(3).max(200).optional(),
    shortName: z.string().trim().min(1).max(50).optional(),
    country: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
export type ApproveDemoRequestInput = z.infer<typeof ApproveDemoRequestSchema>

export const RejectDemoRequestSchema = z
  .object({
    reason: DemoRejectionReasonSchema,
    /** Внутренняя заметка: в письмо не уходит, заявителю не показывается. */
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
export type RejectDemoRequestInput = z.infer<typeof RejectDemoRequestSchema>

// ── Мастер первичной настройки ───────────────────────────────────────────────

/**
 * Шаги мастера в том порядке, в котором вуз их проходит.
 *
 * Порядок не произвольный, он задан зависимостями данных: группы не к чему привязать
 * без факультетов, расписание невозможно без семестра и аудиторий, а старост и
 * студентов приглашает декан — значит, декан должен появиться раньше.
 *
 * `launch` — не шаг заполнения, а проверка: чек-лист и перевод вуза в рабочее состояние.
 */
export const ONBOARDING_STEPS = [
  'profile',
  'faculties',
  'specialties',
  'groups',
  'rooms',
  'terms',
  'subjects',
  'deans',
  'launch',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const OnboardingStepSchema = z.enum(ONBOARDING_STEPS)

/**
 * Шаги, которые разрешено пропустить.
 *
 * Список закрытый, и это важнее, чем кажется. Без факультетов и групп платформа не
 * работает вообще — пропуск такого шага не «ускоряет запуск», а выпускает вуз в
 * нерабочем виде. Пропускать можно то, что на старте правда бывает не нужно:
 * аудитории (пока не печатают QR), предметы и справочник специальностей.
 */
export const SKIPPABLE_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'specialties',
  'rooms',
  'subjects',
]

export const SkippableOnboardingStepSchema = OnboardingStepSchema.refine(
  (step) => SKIPPABLE_ONBOARDING_STEPS.includes(step),
  { message: 'Этот шаг нельзя пропустить' },
)

export const SkipOnboardingStepSchema = z.object({ step: SkippableOnboardingStepSchema }).strict()
export type SkipOnboardingStepInput = z.infer<typeof SkipOnboardingStepSchema>
