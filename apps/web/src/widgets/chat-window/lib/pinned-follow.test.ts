import { describe, expect, it } from 'vitest'
import { pinnedIndexForViewport } from './pinned-follow'

// Порядок полосы — от недавно закреплённых к давним, а не по времени сообщений.
const pinned = [
  { id: 'b', createdAt: '2026-11-10T10:00:00.000Z' },
  { id: 'c', createdAt: '2026-11-15T10:00:00.000Z' },
  { id: 'a', createdAt: '2026-11-01T10:00:00.000Z' },
]

describe('pinnedIndexForViewport', () => {
  it('показывает ближайшее закреплённое выше видимой области', () => {
    // Верх ленты — 12 ноября: выше него «a» (1-е) и «b» (10-е), ближайшее — «b».
    expect(pinnedIndexForViewport(pinned, '2026-11-12T00:00:00.000Z')).toBe(0)
  })

  it('видимое закреплённое не считается «выше» — берётся предыдущее', () => {
    expect(pinnedIndexForViewport(pinned, '2026-11-15T10:00:00.000Z')).toBe(0)
    expect(pinnedIndexForViewport(pinned, '2026-11-16T00:00:00.000Z')).toBe(1)
  })

  it('выше видимой области закреплённых нет — самое новое', () => {
    expect(pinnedIndexForViewport(pinned, '2026-10-01T00:00:00.000Z')).toBe(1)
  })

  it('пустой набор — 0', () => {
    expect(pinnedIndexForViewport([], '2026-11-16T00:00:00.000Z')).toBe(0)
  })
})
