import { z } from 'zod'

// Аналитика декана (docs/ACADEMIC_CORE.md, задача 14) — read-only агрегаты по факультету.
export const FacultyAnalyticsQuerySchema = z
  .object({
    facultyId: z.string().min(1).optional(),
  })
  .strict()
export type FacultyAnalyticsQueryInput = z.infer<typeof FacultyAnalyticsQuerySchema>

// ── Аналитика платформы (роль PLATFORM_ADMIN / PLATFORM_MODERATOR) ───────────
// Read-only агрегаты по всей платформе для дашборда. Все ряды строятся на сервере:
// клиент не считает и не досчитывает — иначе цифра в плитке и цифра на графике
// начинают расходиться.

/** Шаг корзины во временных рядах. */
export const PLATFORM_INTERVALS = ['day', 'week', 'month'] as const
export const PlatformIntervalSchema = z.enum(PLATFORM_INTERVALS)
export type PlatformInterval = (typeof PLATFORM_INTERVALS)[number]

// ── Пределы периода ──────────────────────────────────────────────────────────
// Период раньше не ограничивался ничем: `from=1970-01-01&interval=day` строил около
// 20 000 корзин, и на каждую SQL делал диапазонный проход по журналу аудита — минуты
// нагрузки на общую БД от одного запроса, а кэш по ключу с произвольным `from` не
// помогает. Пределы проверяет схема (422 до похода в БД), а сервис дополнительно режет
// период теми же числами — на случай вызова в обход контроллера.

/** Период по умолчанию, дни: его подставляет сервис, если клиент не прислал `from`. */
export const PLATFORM_DEFAULT_RANGE_DAYS = 30
/** Потолок корзин в ряду: год по дням. Дальше линия не читается, а SQL — дорожает. */
export const PLATFORM_MAX_BUCKETS = 366
/**
 * Потолок длины периода, дни: два года. Держит и ряды без корзин — тепловая карта и
 * топ действий читают журнал аудита за весь период, шаг их не ограничивает.
 */
export const PLATFORM_MAX_RANGE_DAYS = 731

const DAY_MS = 24 * 60 * 60 * 1000
/** Длина корзины в днях — с запасом для месяца: предел считается по самой длинной. */
const INTERVAL_DAYS: Record<PlatformInterval, number> = { day: 1, week: 7, month: 31 }

/** Самый длинный допустимый период для шага: не больше корзин и не больше двух лет. */
export function platformMaxRangeDays(interval: PlatformInterval = 'day'): number {
  return Math.min(PLATFORM_MAX_RANGE_DAYS, PLATFORM_MAX_BUCKETS * INTERVAL_DAYS[interval])
}

/**
 * Проверка периода с теми же значениями по умолчанию, что подставит сервис: `to` —
 * «сейчас», `from` — за 30 дней до `to`. Иначе `from=1970` без `to` прошёл бы проверку
 * как «период не задан».
 */
function checkPlatformRange(
  v: { from?: Date; to?: Date; interval?: PlatformInterval },
  ctx: z.RefinementCtx,
): void {
  const to = v.to ?? new Date()
  const from = v.from ?? new Date(to.getTime() - PLATFORM_DEFAULT_RANGE_DAYS * DAY_MS)
  if (from.getTime() >= to.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Начало периода должно быть раньше конца',
      path: [v.from ? 'from' : 'to'],
    })
    return
  }
  const maxDays = platformMaxRangeDays(v.interval)
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Период длиннее допустимого: не больше ${maxDays} дн. для этого шага`,
      path: ['from'],
    })
  }
}

// Период: полуинтервал [from, to). Значения по умолчанию (последние 30 дней)
// подставляет сервис — так они одинаковы для всех эндпоинтов.
//
// Объект без проверки периода живёт отдельно: `extend` у схемы с refine недоступен, а
// проверка обязана стоять на каждой итоговой схеме, а не только на базовой.
const PlatformRangeObject = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    interval: PlatformIntervalSchema.optional(),
  })
  .strict()

export const PlatformRangeQuerySchema = PlatformRangeObject.superRefine(checkPlatformRange)
export type PlatformRangeQueryInput = z.infer<typeof PlatformRangeQuerySchema>

export const PlatformTopActionsQuerySchema = PlatformRangeObject.extend({
  limit: z.coerce.number().int().min(1).max(20).optional(),
})
  .strict()
  .superRefine(checkPlatformRange)
export type PlatformTopActionsQueryInput = z.infer<typeof PlatformTopActionsQuerySchema>

// ── Часовой пояс суточного профиля ───────────────────────────────────────────
// Активность по часам без зоны не читается: платформенная роль смотрит на все вузы
// сразу, и «пик в 18 UTC» — это 23:00 в Алматы, то есть картина рабочего дня
// оказывается сдвинутой почти на сутки. Зону присылает клиент (свою), сервер
// раскладывает часы в ней.
//
// Проверка — попыткой построить Intl.DateTimeFormat, а не списком зон: список
// живёт в ICU и обновляется вместе с рантаймом. Регулярное выражение перед этим
// отсекает то, что Intl примет, а Postgres поймёт иначе: смещение вида «+05:00»
// у POSIX-зон имеет обратный знак.
const IANA_ZONE = /^[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+)*$/

function isKnownTimeZone(tz: string): boolean {
  if (!IANA_ZONE.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isKnownTimeZone, { message: 'Неизвестный часовой пояс' })

/** Период + зона: только для активности по часам, остальные ряды режутся по UTC. */
export const PlatformActivityQuerySchema = PlatformRangeObject.extend({
  tz: TimeZoneSchema.optional(),
})
  .strict()
  .superRefine(checkPlatformRange)
export type PlatformActivityQueryInput = z.infer<typeof PlatformActivityQuerySchema>

// ── Аналитика вуза (роль UNIVERSITY_ADMIN) ───────────────────────────────────
// Scope — вуз из токена, параметром не принимается. Ряды по неделям: 12 ≈ семестр,
// дальше линия становится нечитаемой.
export const UniversityWeeksQuerySchema = z
  .object({
    weeks: z.coerce.number().int().min(1).max(52).optional(),
  })
  .strict()
export type UniversityWeeksQueryInput = z.infer<typeof UniversityWeeksQuerySchema>
