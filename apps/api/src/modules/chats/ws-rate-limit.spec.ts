import { takeToken } from './ws-rate-limit'

describe('takeToken — корзина токенов сокета', () => {
  const limit = { capacity: 3, refillPerSecond: 2 }

  it('пропускает запас подряд и отказывает сверх него', () => {
    const store: Record<string, unknown> = {}
    const results = [0, 1, 2, 3].map(() => takeToken(store, 'k', limit, 1000))
    expect(results).toEqual([true, true, true, false])
  })

  it('восполняется со временем, но не выше запаса', () => {
    const store: Record<string, unknown> = {}
    for (let i = 0; i < 3; i += 1) takeToken(store, 'k', limit, 0)
    expect(takeToken(store, 'k', limit, 0)).toBe(false)
    // Полсекунды — один токен.
    expect(takeToken(store, 'k', limit, 500)).toBe(true)
    expect(takeToken(store, 'k', limit, 500)).toBe(false)
    // Долгая пауза копит не больше запаса.
    const later = [0, 1, 2, 3].map(() => takeToken(store, 'k', limit, 60_000))
    expect(later).toEqual([true, true, true, false])
  })

  it('отказ токен не тратит — долг не копится', () => {
    const store: Record<string, unknown> = {}
    for (let i = 0; i < 3; i += 1) takeToken(store, 'k', limit, 0)
    for (let i = 0; i < 50; i += 1) takeToken(store, 'k', limit, 0)
    expect(takeToken(store, 'k', limit, 500)).toBe(true)
  })

  it('корзины с разными ключами независимы', () => {
    const store: Record<string, unknown> = {}
    for (let i = 0; i < 3; i += 1) takeToken(store, 'a', limit, 0)
    expect(takeToken(store, 'a', limit, 0)).toBe(false)
    expect(takeToken(store, 'b', limit, 0)).toBe(true)
  })
})
