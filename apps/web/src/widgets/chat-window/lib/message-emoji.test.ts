import { describe, expect, it } from 'vitest'
import { emojiOnlyCount } from './message-emoji'

describe('emojiOnlyCount', () => {
  it('считает 1–3 эмодзи, включая составные и флаги', () => {
    expect(emojiOnlyCount('🔥')).toBe(1)
    expect(emojiOnlyCount('👍🏽 ❤️')).toBe(2)
    expect(emojiOnlyCount('👨‍👩‍👧🇰🇿😀')).toBe(3)
  })

  it('больше трёх эмодзи — обычный пузырь', () => {
    expect(emojiOnlyCount('😀😀😀😀')).toBe(0)
  })

  it('текст, цифры и знаки рядом с эмодзи — обычный пузырь', () => {
    expect(emojiOnlyCount('ок 👍')).toBe(0)
    expect(emojiOnlyCount('1')).toBe(0)
    expect(emojiOnlyCount('!')).toBe(0)
    expect(emojiOnlyCount('')).toBe(0)
  })
})
