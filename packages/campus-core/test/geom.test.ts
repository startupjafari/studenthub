import { describe, expect, it } from 'vitest'
import {
  COORD_LIMIT_MM,
  centroid,
  compareDirections,
  interiorPoint,
  orient,
  pointInPolygon,
  segmentContact,
  signedArea2,
} from '../src/index.js'

describe('точные предикаты', () => {
  it('ориентация точна на краю допустимых координат', () => {
    const L = COORD_LIMIT_MM
    expect(orient({ x: -L, y: -L }, { x: L, y: L }, { x: L - 1, y: L })).toBeGreaterThan(0)
    expect(orient({ x: -L, y: -L }, { x: L, y: L }, { x: L, y: L - 1 })).toBeLessThan(0)
    expect(orient({ x: -L, y: -L }, { x: L, y: L }, { x: 0, y: 0 })).toBe(0)
  })

  it('пересечение крест-накрест — точка, округлённая до мм', () => {
    expect(
      segmentContact({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toEqual({
      kind: 'point',
      p: { x: 5, y: 5 },
    })
    const c = segmentContact({ x: 0, y: 0 }, { x: 3, y: 1 }, { x: 0, y: 1 }, { x: 3, y: 0 })
    expect(c).toEqual({ kind: 'point', p: { x: 2, y: 1 } }) // 1.5 → 2, 0.5 → 1 (Math.round)
  })

  it('касание концом, наложение и непересекающиеся', () => {
    expect(segmentContact({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toEqual(
      {
        kind: 'point',
        p: { x: 5, y: 0 },
      },
    )
    expect(
      segmentContact({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 }),
    ).toEqual({
      kind: 'overlap',
      points: [
        { x: 10, y: 0 },
        { x: 5, y: 0 },
      ],
    })
    expect(
      segmentContact({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }),
    ).toEqual({
      kind: 'point',
      p: { x: 10, y: 0 },
    })
    expect(
      segmentContact({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }),
    ).toEqual({ kind: 'none' })
    expect(
      segmentContact({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 0 }, { x: 20, y: 0 }),
    ).toEqual({ kind: 'none' })
  })

  it('направления сортируются против часовой от +X без atan2', () => {
    const dirs = [
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: -1 },
    ]
    expect([...dirs].sort(compareDirections)).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
    ])
  })
})

describe('многоугольники', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('площадь со знаком обхода', () => {
    expect(signedArea2(square)).toBe(200)
    expect(signedArea2([...square].reverse())).toBe(-200)
  })

  it('точка внутри, снаружи и на границе', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe('inside')
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe('outside')
    expect(pointInPolygon({ x: 10, y: 5 }, square)).toBe('boundary')
    expect(pointInPolygon({ x: 5, y: 5 }, [...square].reverse())).toBe('inside')
  })

  it('центр масс и внутренняя точка Г-образной комнаты', () => {
    expect(centroid(square)).toEqual({ x: 5, y: 5 })
    const L = [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 1000 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 10000 },
      { x: 0, y: 10000 },
    ]
    const p = interiorPoint(L)!
    expect(pointInPolygon(p, L)).toBe('inside')
    // Центр масс «Г» лежит снаружи — точка нашлась поиском.
    expect(pointInPolygon(centroid(L), L)).toBe('outside')
  })

  it('внутренняя точка обходит дыру', () => {
    const big = [
      { x: 0, y: 0 },
      { x: 9000, y: 0 },
      { x: 9000, y: 9000 },
      { x: 0, y: 9000 },
    ]
    const hole = [
      { x: 3000, y: 3000 },
      { x: 6000, y: 3000 },
      { x: 6000, y: 6000 },
      { x: 3000, y: 6000 },
    ]
    const p = interiorPoint(big, [hole])!
    expect(pointInPolygon(p, big)).toBe('inside')
    expect(pointInPolygon(p, hole)).toBe('outside')
  })
})
