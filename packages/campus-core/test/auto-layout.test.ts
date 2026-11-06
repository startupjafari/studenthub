import { describe, expect, it } from 'vitest'
import {
  autoLayout,
  buildFaces,
  matchSpaces,
  outlineFromShape,
  validateFloor,
  type FloorPlanDoc,
} from '../src/index.js'

function doc(r: ReturnType<typeof autoLayout>): FloorPlanDoc {
  if ('error' in r) throw new Error(r.error)
  return r.doc
}

/** Помещения, у которых ни одна стена не несёт двери. */
function withoutDoor(d: FloorPlanDoc): string[] {
  const faces = buildFaces(d).faces
  const { assignments } = matchSpaces(d, {}, faces)
  const doorWalls = new Set(
    Object.values(d.openings)
      .filter((o) => o.type === 'door')
      .map((o) => o.wallId),
  )
  return Object.entries(d.spaces)
    .filter(([, s]) => s.kind !== 'corridor' && s.kind !== 'hall')
    .filter(([id]) => {
      const f = faces.find((x) => x.id === assignments[id])
      return !f || !f.wallIds.some((w) => doorWalls.has(w))
    })
    .map(([id]) => id)
}

describe('автопланировка', () => {
  for (const shape of ['rect', 'L', 'U', 'T'] as const) {
    it(`${shape}: один коридор, у каждого помещения дверь, без ошибок проверки`, () => {
      const d = doc(autoLayout(outlineFromShape(shape, 60000, 45000, 15000), { level: 2 }))
      const kinds = Object.values(d.spaces).map((s) => s.kind)
      expect(kinds.filter((k) => k === 'corridor')).toHaveLength(1)
      expect(kinds).toContain('stairwell')
      expect(kinds.filter((k) => k === 'office').length).toBeGreaterThan(10)
      expect(withoutDoor(d)).toEqual([])
      expect(
        validateFloor(d, { floorHeightMm: 3300 }).filter((p) => p.severity === 'error'),
      ).toEqual([])
    })
  }

  it('номера кабинетов — по уровню этажа', () => {
    const d = doc(autoLayout(outlineFromShape('rect', 60000, 18000, 0), { level: 3 }))
    const numbers = Object.values(d.spaces)
      .map((s) => s.number)
      .filter(Boolean)
    expect(numbers.every((n) => n!.startsWith('3'))).toBe(true)
    expect(numbers).toContain('301')
  })

  it('вход и окна: на 1 этаже вход есть, в подвале нет ни входа, ни окон', () => {
    const outline = outlineFromShape('rect', 60000, 18000, 0)
    const first = doc(autoLayout(outline, { level: 1 }))
    const basement = doc(autoLayout(outline, { level: 0 }))
    const wide = (d: FloorPlanDoc) =>
      Object.values(d.openings).filter((o) => o.type === 'door' && o.widthMm > 1000)
    expect(wide(first).length).toBeGreaterThan(wide(basement).length)
    expect(Object.values(first.openings).some((o) => o.type === 'window')).toBe(true)
    expect(Object.values(basement.openings).some((o) => o.type === 'window')).toBe(false)
  })

  it('лестницы и лифты одного места — одна группа на всех этажах', () => {
    const outline = outlineFromShape('rect', 60000, 18000, 0)
    const groups = (d: FloorPlanDoc) =>
      Object.values(d.verticals)
        .map((v) => v.groupId)
        .sort()
    expect(groups(doc(autoLayout(outline, { level: 1 })))).toEqual(
      groups(doc(autoLayout(outline, { level: 2 }))),
    )
  })

  it('узкий корпус — коридор с кабинетами по одной стороне; совсем маленький — холл', () => {
    const narrow = doc(autoLayout(outlineFromShape('rect', 40000, 8000, 0), { level: 2 }))
    expect(Object.values(narrow.spaces).some((s) => s.kind === 'office')).toBe(true)
    const tiny = doc(autoLayout(outlineFromShape('rect', 10000, 5000, 0), { level: 2 }))
    expect(Object.values(tiny.spaces).map((s) => s.kind)).toEqual(['hall'])
  })

  it('контур не по осям — отказ', () => {
    const r = autoLayout(
      [
        { x: 0, y: 0 },
        { x: 20000, y: 0 },
        { x: 15000, y: 10000 },
        { x: 0, y: 10000 },
      ],
      { level: 1 },
    )
    expect(r).toEqual({ error: 'NOT_ORTHOGONAL' })
  })
})
