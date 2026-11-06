import { describe, expect, it } from 'vitest'
import { wallInputToIso } from './university-time'

describe('wallInputToIso', () => {
  // Регрессия: время записи бралось в поясе браузера, а не вуза.
  it('переводит настенное время вуза в UTC', () => {
    expect(wallInputToIso('2026-10-31T23:59', 'Europe/Moscow')).toBe('2026-10-31T20:59:00.000Z')
  })

  it('учитывает летнее время пояса', () => {
    expect(wallInputToIso('2026-07-01T12:00', 'Europe/Berlin')).toBe('2026-07-01T10:00:00.000Z')
    expect(wallInputToIso('2026-01-15T12:00', 'Europe/Berlin')).toBe('2026-01-15T11:00:00.000Z')
  })

  it('без пояса — время браузера, как раньше', () => {
    expect(wallInputToIso('2026-10-31T10:00', null)).toBe(
      new Date('2026-10-31T10:00').toISOString(),
    )
  })
})
