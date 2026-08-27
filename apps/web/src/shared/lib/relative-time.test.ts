import { describe, expect, it, vi, afterEach } from 'vitest'
import { relativeTime } from './relative-time'

// Отсчёт идёт от Date.now(), поэтому в тестах время фиксируем.
function at(iso: string, offsetSec: number): string {
  return new Date(new Date(iso).getTime() + offsetSec * 1000).toISOString()
}

const NOW = '2026-08-27T12:00:00.000Z'

afterEach(() => vi.useRealTimers())

describe('relativeTime', () => {
  it('выбирает крупнейшую подходящую единицу', () => {
    vi.useFakeTimers().setSystemTime(new Date(NOW))
    expect(relativeTime(at(NOW, -4 * 86400), 'ru')).toContain('4')
    // Неделя не должна показываться как «7 дней».
    expect(relativeTime(at(NOW, -8 * 86400), 'ru')).not.toContain('8')
  })

  it('меньше минуты — без «0 минут назад»', () => {
    vi.useFakeTimers().setSystemTime(new Date(NOW))
    // numeric: 'auto' отдаёт «сейчас» вместо нуля.
    expect(relativeTime(at(NOW, -10), 'ru')).not.toMatch(/^0/)
  })

  it('не зависит от глобальной опорной точки next-intl', () => {
    vi.useFakeTimers().setSystemTime(new Date(NOW))
    const first = relativeTime(at(NOW, -3600), 'ru')
    vi.setSystemTime(new Date(at(NOW, 3600)))
    const later = relativeTime(at(NOW, -3600), 'ru')
    // Через час тот же пост стал старше — значение обязано измениться.
    expect(later).not.toBe(first)
  })
})
