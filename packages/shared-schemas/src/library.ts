import { z } from 'zod'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11): каталог, экземпляры, выдачи, брони.
// Книги берут студенты и старосты своего вуза, выдаёт и принимает библиотекарь, модуль и
// правила выдачи настраивает админ вуза.

// ── Настройки модуля ─────────────────────────────────────────────────────────────────

/** Пределы правил выдачи: что админ вуза вообще может выставить. */
export const LIBRARY_LIMITS = {
  loanDays: { min: 1, max: 365 },
  activeLoans: { min: 1, max: 50 },
  activeReservations: { min: 0, max: 20 },
  holdDays: { min: 1, max: 30 },
  renewals: { min: 0, max: 10 },
} as const

const intIn = (range: { min: number; max: number }) =>
  z.number().int().min(range.min).max(range.max)

/**
 * Правка настроек библиотеки вуза. Любое поле можно не присылать — останется прежним.
 * Срок по умолчанию не может быть больше максимального: иначе каждая выдача «по умолчанию»
 * упиралась бы в отказ.
 */
export const UpdateLibrarySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultLoanDays: intIn(LIBRARY_LIMITS.loanDays).optional(),
    maxLoanDays: intIn(LIBRARY_LIMITS.loanDays).optional(),
    maxActiveLoans: intIn(LIBRARY_LIMITS.activeLoans).optional(),
    maxActiveReservations: intIn(LIBRARY_LIMITS.activeReservations).optional(),
    reservationHoldDays: intIn(LIBRARY_LIMITS.holdDays).optional(),
    maxRenewals: intIn(LIBRARY_LIMITS.renewals).optional(),
  })
  .strict()
export type UpdateLibrarySettingsInput = z.infer<typeof UpdateLibrarySettingsSchema>

export interface LibrarySettingsResponse {
  enabled: boolean
  defaultLoanDays: number
  maxLoanDays: number
  maxActiveLoans: number
  maxActiveReservations: number
  reservationHoldDays: number
  maxRenewals: number
  updatedAt: string | null
}
