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

// Период: полуинтервал [from, to). Значения по умолчанию (последние 30 дней)
// подставляет сервис — так они одинаковы для всех эндпоинтов.
export const PlatformRangeQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    interval: PlatformIntervalSchema.optional(),
  })
  .strict()
export type PlatformRangeQueryInput = z.infer<typeof PlatformRangeQuerySchema>

export const PlatformTopActionsQuerySchema = PlatformRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(20).optional(),
}).strict()
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
export const PlatformActivityQuerySchema = PlatformRangeQuerySchema.extend({
  tz: TimeZoneSchema.optional(),
}).strict()
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
