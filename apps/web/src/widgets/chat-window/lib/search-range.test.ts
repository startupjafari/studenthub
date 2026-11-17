import { describe, expect, it } from 'vitest'
import { dayRangeToIso, formatDayRange, hasDayRange } from './search-range'

describe('период поиска по переписке', () => {
  it('пустой и битый период — не задан', () => {
    expect(hasDayRange({ from: '', to: '' })).toBe(false)
    expect(hasDayRange({ from: 'вчера', to: '' })).toBe(false)
    expect(hasDayRange({ from: '2026-05-01', to: '' })).toBe(true)
    expect(dayRangeToIso({ from: '', to: '' })).toEqual({})
  })

  it('границы — начало первого и конец последнего дня в поясе смотрящего', () => {
    const { from, to } = dayRangeToIso({ from: '2026-05-01', to: '2026-05-03' })
    expect(from).toBe(new Date(2026, 4, 1, 0, 0, 0, 0).toISOString())
    expect(to).toBe(new Date(2026, 4, 3, 23, 59, 59, 999).toISOString())
  })

  it('перепутанные границы меняются местами, одна граница — только она', () => {
    expect(dayRangeToIso({ from: '2026-05-03', to: '2026-05-01' })).toEqual(
      dayRangeToIso({ from: '2026-05-01', to: '2026-05-03' }),
    )
    expect(Object.keys(dayRangeToIso({ from: '', to: '2026-05-03' }))).toEqual(['to'])
  })

  it('подпись: один день — одной датой, без границы — вид «с»/«по»', () => {
    const year = new Date().getFullYear()
    const day = `${year}-03-08`
    expect(formatDayRange({ from: day, to: day }, 'ru')).toEqual({
      kind: 'both',
      text: new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(
        new Date(year, 2, 8),
      ),
    })
    expect(formatDayRange({ from: day, to: '' }, 'ru').kind).toBe('from')
    expect(formatDayRange({ from: '', to: day }, 'ru').kind).toBe('to')
    expect(formatDayRange({ from: '', to: '' }, 'ru')).toEqual({ kind: 'none', text: '' })
    // Другой год — с годом.
    expect(formatDayRange({ from: '2001-01-02', to: '2001-01-05' }, 'en').text).toContain('2001')
  })
})
