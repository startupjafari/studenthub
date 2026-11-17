import { describe, expect, it } from 'vitest'
import { formatViews } from './use-message-views'

describe('formatViews', () => {
  it('маленькие числа — как есть', () => {
    expect(formatViews(0, 'en')).toBe('0')
    expect(formatViews(42, 'ru')).toBe('42')
  })

  // Как у постов канала Telegram: тысячи и миллионы — коротко, по правилам языка.
  it('большие — компактно', () => {
    expect(formatViews(1234, 'en')).toBe('1.2K')
    expect(formatViews(15_000, 'en')).toBe('15K')
    expect(formatViews(2_500_000, 'en')).toBe('2.5M')
  })
})
