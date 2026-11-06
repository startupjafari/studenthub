import { describe, expect, it } from 'vitest'
import { centerPath, type CenterWall } from '../src/nav/center.js'

// Коридор вдоль X: стены по осям y = 0 и y = 2400, толщина 200 — грани на 100 и 2300,
// ось прохода — y = 1200.
const corridor: CenterWall[] = [
  { a: { x: -1000, y: 0 }, b: { x: 30_000, y: 0 }, half: 100 },
  { a: { x: -1000, y: 2400 }, b: { x: 30_000, y: 2400 }, half: 100 },
]

/** Высота линии пути в точке x (путь идёт слева направо). */
function yAt(path: { x: number; y: number }[], x: number): number {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1)
  }
  return NaN
}

describe('centerPath', () => {
  it('путь вдоль стены коридора ложится на его ось, концы на месте', () => {
    const path = centerPath(
      [
        { x: 0, y: 400 },
        { x: 20_000, y: 400 },
      ],
      corridor,
    )
    expect(path[0]).toEqual({ x: 0, y: 400 })
    expect(path.at(-1)).toEqual({ x: 20_000, y: 400 })
    for (const x of [3000, 7000, 10_000, 15_000])
      expect(Math.abs(yAt(path, x) - 1200)).toBeLessThan(30)
  })

  it('стена с одного бока — путь отходит от неё, но не дальше 1,1 м от грани', () => {
    const hall: CenterWall[] = [corridor[0]!]
    const path = centerPath(
      [
        { x: 0, y: 400 },
        { x: 20_000, y: 400 },
      ],
      hall,
    )
    for (const x of [3000, 10_000, 15_000])
      expect(Math.abs(yAt(path, x) - 100 - 1100)).toBeLessThan(30)
  })

  it('сдвиг, при котором путь задел бы стену, не делается', () => {
    // Перегородка поперёк верхней половины коридора: середина упёрлась бы в неё.
    const walls: CenterWall[] = [
      ...corridor,
      { a: { x: 10_000, y: 900 }, b: { x: 10_000, y: 2400 }, half: 100 },
    ]
    const path = centerPath(
      [
        { x: 0, y: 400 },
        { x: 20_000, y: 400 },
      ],
      walls,
    )
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!
      const b = path[i]!
      if ((a.x - 10_000) * (b.x - 10_000) >= 0) continue
      // Отрезок, пересекающий x = 10 м, проходит ниже перегородки (её низ — 0,9 м − 0,1).
      const y = a.y + ((b.y - a.y) * (10_000 - a.x)) / (b.x - a.x)
      expect(y).toBeLessThan(800)
    }
  })
})
