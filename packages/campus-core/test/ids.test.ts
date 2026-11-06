import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomIds } from '../src/index.js'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

describe('randomIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('формат прежний: тип, «_» и 10 знаков base36', () => {
    for (const kind of ['n', 'w', 'o', 's', 'v', 't'] as const) {
      expect(randomIds(kind)).toMatch(new RegExp(`^${kind}_[0-9a-z]{10}$`))
    }
  })

  it('байты вне алфавита отбрасываются, а не сворачиваются по модулю', () => {
    // 36, 63, 100 и 255 после маски 6 бит — 36, 63, 36 и 63: за пределами алфавита.
    const queue = [36, 63, 100, 255, 64, 99, 128, 192, 1, 2, 3, 4, 5, 6]
    vi.stubGlobal('crypto', {
      getRandomValues<T extends Uint8Array>(array: T): T {
        for (let i = 0; i < array.length; i++) array[i] = queue.shift() ?? 0
        return array
      },
    })
    expect(randomIds('n')).toBe('n_0z00123456')
  })

  it('знаки распределены равномерно', () => {
    // При `byte % 36` первые четыре знака выпадали бы в 8/7 раза чаще остальных (+14%).
    const counts = new Map<string, number>()
    for (let i = 0; i < 100_000; i++) {
      for (const c of randomIds('n').slice(2)) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    expect([...counts.keys()].sort().join('')).toBe(ALPHABET)
    const values = [...counts.values()]
    // Ожидание ≈ 27 778 на знак, σ ≈ 164: запас в 6σ с каждой стороны, смещение 14% — нет.
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.08)
  })
})
