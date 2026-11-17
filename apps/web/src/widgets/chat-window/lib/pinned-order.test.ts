import { describe, expect, it } from 'vitest'
import { dropIndex, dropOffset, mergePinnedOrder, moveItem, shiftFor } from './pinned-order'

describe('moveItem', () => {
  it('переносит вниз и вверх, остальные сдвигаются', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('за пределами списка — без изменений', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})

describe('mergePinnedOrder', () => {
  it('видимые встают на свои места, невидимые (архив) не двигаются', () => {
    // a, x (архивный), b, c — переставили в «Все»: c, a, b.
    expect(mergePinnedOrder(['a', 'x', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'b'])
  })

  it('видимый, которого нет в общем порядке, — в конец', () => {
    expect(mergePinnedOrder(['a', 'b'], ['b', 'a', 'n'])).toEqual(['b', 'a', 'n'])
  })
})

describe('геометрия перетаскивания', () => {
  const rows = [
    { top: 0, height: 72 },
    { top: 72, height: 72 },
    { top: 144, height: 72 },
  ]

  it('место — по центру перетаскиваемой строки', () => {
    // Первую строку утащили на 100 px вниз: её центр 136 — ниже центра второй (108).
    expect(dropIndex(rows, 0, 36 + 100)).toBe(1)
    expect(dropIndex(rows, 0, 36 + 200)).toBe(2)
    expect(dropIndex(rows, 2, 180 - 150)).toBe(0)
  })

  it('строки между исходным и новым местом уступают его на высоту перетаскиваемой', () => {
    expect([0, 1, 2].map((i) => shiftFor(i, 0, 2, 72))).toEqual([0, -72, -72])
    expect([0, 1, 2].map((i) => shiftFor(i, 2, 0, 72))).toEqual([72, 72, 0])
  })

  it('смещение до нового места', () => {
    expect(dropOffset(rows, 0, 2)).toBe(144)
    expect(dropOffset(rows, 2, 0)).toBe(-144)
    expect(dropOffset(rows, 1, 1)).toBe(0)
  })
})
