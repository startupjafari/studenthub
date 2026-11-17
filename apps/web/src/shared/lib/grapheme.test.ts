import { describe, expect, it } from 'vitest'
import { lastGraphemeLength } from './grapheme'

describe('lastGraphemeLength — что стирает кнопка ⌫ панели эмодзи', () => {
  it('обычная буква — одна единица', () => {
    expect(lastGraphemeLength('привет')).toBe(1)
  })

  it('эмодзи вне BMP — суррогатная пара целиком', () => {
    expect(lastGraphemeLength('ок 😂')).toBe(2)
  })

  it('семья (ZWJ-последовательность) и тон кожи — одним знаком', () => {
    expect(lastGraphemeLength('a👨‍👩‍👧')).toBe('👨‍👩‍👧'.length)
    expect(lastGraphemeLength('👍🏽')).toBe('👍🏽'.length)
  })

  it('флаг — две региональные буквы вместе', () => {
    expect(lastGraphemeLength('Казахстан 🇰🇿')).toBe(4)
  })

  it('пустая строка — ноль', () => {
    expect(lastGraphemeLength('')).toBe(0)
  })
})
