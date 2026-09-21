import { describe, expect, it, beforeEach } from 'vitest'
import { resetLocale } from '../i18n'
import { dayLabel, formatAge, sameDay } from './format'

describe('formatAge', () => {
  beforeEach(() => resetLocale('ru'))

  const now = new Date('2026-09-21T12:00:00Z').getTime()

  it('минуты — пока меньше часа', () => {
    expect(formatAge(now - 40 * 60_000, now)).toBe('40 мин')
  })

  it('часы — пока меньше суток', () => {
    expect(formatAge(now - 5 * 60 * 60_000, now)).toBe('5 ч')
  })

  it('дни — дальше', () => {
    expect(formatAge(now - 50 * 60 * 60_000, now)).toBe('2 дн')
  })

  // Часы клиента могут уйти вперёд; отрицательный возраст не должен превращаться
  // в «-3 мин» на экране.
  it('не показывает отрицательный возраст', () => {
    expect(formatAge(now + 10 * 60_000, now)).toBe('0 мин')
  })
})

describe('dayLabel', () => {
  beforeEach(() => resetLocale('ru'))

  it('сегодняшнее называет «Сегодня»', () => {
    expect(dayLabel(new Date().toISOString())).toBe('Сегодня')
  })

  it('вчерашнее называет «Вчера»', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(dayLabel(yesterday.toISOString())).toBe('Вчера')
  })

  it('более старое называет датой', () => {
    expect(dayLabel('2026-01-15T10:00:00Z')).toMatch(/январ/i)
  })
})

describe('sameDay', () => {
  it('различает соседние дни', () => {
    expect(sameDay(new Date('2026-09-21T23:59:00'), new Date('2026-09-22T00:01:00'))).toBe(false)
  })
})
