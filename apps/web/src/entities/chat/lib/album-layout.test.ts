import { describe, expect, it } from 'vitest'
import { albumLayout } from './album-layout'

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

describe('albumLayout', () => {
  it('каждый кадр внутри блока и кадры не налезают друг на друга', () => {
    for (const ratios of [
      [1, 1],
      [2, 2],
      [0.6, 1, 1],
      [1.8, 1, 0.7],
      [1, 1, 1, 1],
      [0.5, 1.5, 1, 2, 0.8, 1, 1.3, 0.9, 1, 3],
    ]) {
      const { tiles, aspect } = albumLayout(ratios)
      expect(tiles).toHaveLength(ratios.length)
      expect(aspect).toBeGreaterThan(0)
      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0)
        expect(t.y).toBeGreaterThanOrEqual(0)
        expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-6)
        expect(t.y + t.h).toBeLessThanOrEqual(1 + 1e-6)
      }
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i]!
          const b = tiles[j]!
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false)
        }
      }
    }
  })

  it('два широких кадра — друг под другом, два квадрата — рядом', () => {
    const wide = albumLayout([2, 2]).tiles
    expect(near(wide[0]!.w, 1)).toBe(true)
    expect(wide[1]!.y).toBeGreaterThan(0)
    const square = albumLayout([1, 1]).tiles
    expect(square[1]!.x).toBeGreaterThan(0)
    expect(near(square[0]!.y, square[1]!.y)).toBe(true)
  })

  it('узкий первый кадр — колонкой слева во всю высоту', () => {
    const { tiles } = albumLayout([0.6, 1, 1])
    expect(near(tiles[0]!.h, 1)).toBe(true)
    expect(tiles[1]!.x).toBeGreaterThan(0)
  })

  it('широкий первый кадр — полосой сверху во всю ширину', () => {
    const { tiles } = albumLayout([1.8, 1, 1])
    expect(near(tiles[0]!.w, 1)).toBe(true)
    expect(tiles[1]!.y).toBeGreaterThan(tiles[0]!.h - 1e-6)
  })
})
