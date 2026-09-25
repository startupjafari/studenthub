import { describe, expect, it } from 'vitest'
import { holidaysByDate } from './calendar-events'

// Сетка месяца приходит 42 ячейками с хвостами соседних месяцев — карта праздников
// обязана покрывать и их, иначе Наурыз пропадал бы в апрельской сетке.

const days = (year: number, month: number, from: number, to: number): Date[] =>
  Array.from({ length: to - from + 1 }, (_, i) => new Date(year, month - 1, from + i))

describe('праздники в календаре', () => {
  it('размечает все дни праздника', () => {
    const map = holidaysByDate(days(2026, 3, 19, 25))
    expect(map.get('2026-03-20')?.id).toBe('oraza-ait')
    expect(map.get('2026-03-21')?.id).toBe('nauryz')
    expect(map.get('2026-03-23')?.id).toBe('nauryz')
    expect(map.has('2026-03-24')).toBe(false)
  })

  it('нерабочий день отличим от рабочего праздника', () => {
    const map = holidaysByDate(days(2026, 3, 20, 21))
    expect(map.get('2026-03-21')?.dayOff).toBe(true)
    // Ораза айт отмечают, но это рабочий день — календарь не имеет права утверждать обратное.
    expect(map.get('2026-03-20')?.dayOff).toBe(false)
  })

  it('день памяти показывается, а выключенный мягкий праздник — нет', () => {
    expect(holidaysByDate(days(2026, 5, 31, 31)).get('2026-05-31')?.id).toBe(
      'repression-victims-day',
    )
    expect(holidaysByDate(days(2026, 10, 31, 31)).has('2026-10-31')).toBe(false)
  })

  it('дни без праздника в карту не попадают', () => {
    expect(holidaysByDate(days(2026, 9, 24, 26)).size).toBe(0)
  })
})
