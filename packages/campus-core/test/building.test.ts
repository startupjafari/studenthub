import { describe, expect, it } from 'vitest'
import {
  SitePlanSchema,
  buildFaces,
  canSeeSpace,
  checkOutline,
  cloneFloorPlan,
  emptySitePlan,
  floorForViewer,
  floorFromOutline,
  generateFloor,
  sequentialIds,
  spaceIndex,
  toBuilding,
  toCampus,
} from '../src/index.js'

const square = [
  { x: 0, y: 0 },
  { x: 10000, y: 0 },
  { x: 10000, y: 10000 },
  { x: 0, y: 10000 },
]

describe('корпус', () => {
  it('контур: ошибки формы', () => {
    expect(checkOutline(square)).toBeNull()
    expect(checkOutline(square.slice(0, 2))).toBe('TOO_FEW_POINTS')
    expect(checkOutline([...square, { x: 0, y: 0 }])).toBe('DUPLICATE_POINTS')
    // Точки на одной прямой: последнее ребро ложится на первые — тоже самопересечение.
    expect(
      checkOutline([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toBe('SELF_INTERSECTION')
    // «Бабочка» — самопересечение.
    expect(
      checkOutline([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe('SELF_INTERSECTION')
  })

  it('этаж стартует с наружных стен по контуру (обход по часовой разворачивается)', () => {
    const doc = floorFromOutline([...square].reverse(), sequentialIds())
    expect(Object.keys(doc.walls)).toHaveLength(4)
    expect(buildFaces(doc).faces[0]!.areaMm2).toBe(100_000_000)
  })

  it('перевод координат корпус ↔ кампус', () => {
    const t = { x: 50_000, y: 20_000, rotationDeg: 90 }
    expect(toCampus({ x: 1000, y: 0 }, t)).toEqual({ x: 50_000, y: 21_000 })
    expect(toBuilding(toCampus({ x: 1234, y: -567 }, t), t)).toEqual({ x: 1234, y: -567 })
  })
})

describe('копия этажа', () => {
  it('все id новые, ссылки внутри копии, Room сброшен, номера сдвинуты, лестницы сохранили группу', () => {
    const doc = generateFloor({ roomsPerSide: 4, buildingCode: 'А', level: 3 })
    const copy = cloneFloorPlan(doc, sequentialIds(), { renumber: { from: '3', to: '4' } })
    const oldIds = new Set([
      ...Object.keys(doc.nodes),
      ...Object.keys(doc.walls),
      ...Object.keys(doc.openings),
      ...Object.keys(doc.spaces),
    ])
    for (const id of [
      ...Object.keys(copy.nodes),
      ...Object.keys(copy.walls),
      ...Object.keys(copy.openings),
      ...Object.keys(copy.spaces),
    ]) {
      expect(oldIds.has(id)).toBe(false)
    }
    for (const w of Object.values(copy.walls)) {
      expect(copy.nodes[w.a]).toBeDefined()
      expect(copy.nodes[w.b]).toBeDefined()
    }
    for (const o of Object.values(copy.openings)) expect(copy.walls[o.wallId!]).toBeDefined()
    for (const s of Object.values(copy.spaces)) {
      expect(s.roomId).toBeUndefined()
      for (const e of s.edges) expect(copy.walls[e]).toBeDefined()
    }
    const numbers = Object.values(copy.spaces)
      .map((s) => s.number)
      .filter(Boolean)
    expect(numbers.every((n) => n!.startsWith('А4'))).toBe(true)
    expect(
      Object.values(copy.verticals)
        .map((v) => v.groupId)
        .sort(),
    ).toEqual(
      Object.values(doc.verticals)
        .map((v) => v.groupId)
        .sort(),
    )
    expect(buildFaces(copy).faces).toHaveLength(buildFaces(doc).faces.length)
  })
})

describe('публикация', () => {
  it('индекс помещений в координатах кампуса, без скрытых', () => {
    const doc = generateFloor({ roomsPerSide: 3 })
    const first = Object.keys(doc.spaces)[0]!
    const hidden = {
      ...doc,
      spaces: { ...doc.spaces, [first]: { ...doc.spaces[first]!, visibility: 'hidden' as const } },
    }
    const index = spaceIndex(hidden, { x: 100_000, y: 0, rotationDeg: 0 })
    expect(index).toHaveLength(Object.keys(doc.spaces).length - 1)
    expect(index.every((e) => e.center.x >= 100_000 && e.areaMm2 > 0)).toBe(true)
  })

  it('выдача зрителю: служебные — сотрудникам, скрытые — только редактору', () => {
    expect(canSeeSpace('public', 'public')).toBe(true)
    expect(canSeeSpace('staff', 'public')).toBe(false)
    expect(canSeeSpace('staff', 'staff')).toBe(true)
    expect(canSeeSpace('hidden', 'staff')).toBe(false)
    expect(canSeeSpace('hidden', 'editor')).toBe(true)
    const doc = generateFloor({ roomsPerSide: 3 })
    const [a, b] = Object.keys(doc.spaces)
    const door = Object.keys(doc.openings)[0]!
    const marked = {
      ...doc,
      spaces: {
        ...doc.spaces,
        [a!]: { ...doc.spaces[a!]!, visibility: 'staff' as const },
        [b!]: { ...doc.spaces[b!]!, visibility: 'hidden' as const },
      },
      openings: {
        ...doc.openings,
        [door]: { ...doc.openings[door]!, access: 'staff' as const } as never,
      },
    }
    const pub = floorForViewer(marked, 'public')
    expect(pub.spaces[a!]).toBeUndefined()
    expect(pub.spaces[b!]).toBeUndefined()
    expect(pub.openings[door]).toMatchObject({ access: 'closed' })
    expect(Object.keys(pub.walls)).toHaveLength(Object.keys(doc.walls).length)
    expect(floorForViewer(marked, 'staff').spaces[a!]).toBeDefined()
  })

  it('территория: пустой документ проходит схему', () => {
    expect(SitePlanSchema.safeParse(emptySitePlan()).success).toBe(true)
  })
})

describe('контуры-шаблоны корпуса', () => {
  it('все шаблоны — корректные многоугольники против часовой', async () => {
    const { outlineFromShape, signedArea2 } = await import('../src/index.js')
    for (const shape of ['rect', 'L', 'U', 'T'] as const) {
      const o = outlineFromShape(shape, 60000, 40000, 15000)
      expect(checkOutline(o), shape).toBeNull()
      expect(signedArea2(o), shape).toBeGreaterThan(0)
    }
  })
})
