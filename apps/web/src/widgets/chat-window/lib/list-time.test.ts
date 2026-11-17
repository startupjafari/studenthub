import { describe, expect, it } from 'vitest'
import { chatListTime } from './list-time'

// Полдень среды, 12 ноября 2025 — от него считаются «сегодня», «на неделе» и «в этом году».
const NOW = new Date(2025, 10, 12, 12, 0)
const at = (y: number, m: number, d: number, h = 9, min = 5): string =>
  new Date(y, m, d, h, min).toISOString()

describe('chatListTime', () => {
  it('сегодня — часы и минуты', () => {
    expect(chatListTime(at(2025, 10, 12, 9, 5), 'ru', NOW)).toBe('09:05')
  })

  it('время чуть впереди часов устройства — всё ещё «сегодня»', () => {
    expect(chatListTime(at(2025, 10, 13, 0, 1), 'ru', NOW)).toBe('00:01')
  })

  it('последние шесть дней — день недели', () => {
    const expected = new Date(2025, 10, 10).toLocaleDateString('ru', { weekday: 'short' })
    expect(chatListTime(at(2025, 10, 10), 'ru', NOW)).toBe(expected)
  })

  it('неделя назад и раньше в этом году — число и месяц', () => {
    const expected = new Date(2025, 10, 5).toLocaleDateString('ru', {
      day: 'numeric',
      month: 'short',
    })
    expect(chatListTime(at(2025, 10, 5), 'ru', NOW)).toBe(expected)
  })

  it('прошлый год — дата с годом', () => {
    expect(chatListTime(at(2024, 0, 31), 'ru', NOW)).toBe('31.01.24')
  })

  it('битая строка — пусто, а не «Invalid Date»', () => {
    expect(chatListTime('nope', 'ru', NOW)).toBe('')
  })
})
