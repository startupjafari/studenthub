import { describe, expect, it } from 'vitest'

import { dateFormatter, formatDate } from './date-format'

describe('date-format', () => {
  const at = new Date(2026, 10, 21, 9, 5)

  it('совпадает с toLocale*String при тех же опциях', () => {
    const time = { hour: '2-digit', minute: '2-digit' } as const
    const day = { day: 'numeric', month: 'long', year: 'numeric' } as const
    expect(formatDate(at, 'ru', time)).toBe(at.toLocaleTimeString('ru', time))
    expect(formatDate(at, 'en', day)).toBe(at.toLocaleDateString('en', day))
    // `kk` — тег платформы из useLocale() (next-intl), а не код приложения `kz`.
    expect(formatDate(at.toISOString(), 'kk', day)).toBe(at.toLocaleDateString('kk', day))
  })

  it('отдаёт один форматтер на пару «локаль + опции»', () => {
    const a = dateFormatter('ru', { weekday: 'short' })
    expect(dateFormatter('ru', { weekday: 'short' })).toBe(a)
    expect(dateFormatter('en', { weekday: 'short' })).not.toBe(a)
    expect(dateFormatter('ru', { weekday: 'long' })).not.toBe(a)
  })
})
