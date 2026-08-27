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

// ── Аналитика вуза (роль UNIVERSITY_ADMIN) ───────────────────────────────────
// Scope — вуз из токена, параметром не принимается. Ряды по неделям: 12 ≈ семестр,
// дальше линия становится нечитаемой.
export const UniversityWeeksQuerySchema = z
  .object({
    weeks: z.coerce.number().int().min(1).max(52).optional(),
  })
  .strict()
export type UniversityWeeksQueryInput = z.infer<typeof UniversityWeeksQuerySchema>
