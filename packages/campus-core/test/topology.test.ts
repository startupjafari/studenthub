import { describe, expect, it } from 'vitest'
import {
  PlanBuilder,
  WALL,
  addWall,
  buildFaces,
  emptyFloorPlan,
  moveNode,
  removeWall,
  sequentialIds,
  validateFloor,
  wallLength,
  type FloorPlanDoc,
} from '../src/index.js'

function segments(doc: FloorPlanDoc): string[] {
  return Object.values(doc.walls)
    .map((w) => {
      const a = doc.nodes[w.a]!
      const b = doc.nodes[w.b]!
      const [p, q] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a]
      return `${p.x},${p.y}-${q.x},${q.y}`
    })
    .sort()
}

const errors = (doc: FloorPlanDoc) => validateFloor(doc).filter((p) => p.severity === 'error')

describe('стена', () => {
  it('новая стена создаёт два узла; нулевая — ничего', () => {
    const ids = sequentialIds()
    const { doc, created } = addWall(emptyFloorPlan(), { x: 0, y: 0 }, { x: 5000, y: 0 }, WALL, ids)
    expect(Object.keys(doc.nodes)).toHaveLength(2)
    expect(created).toEqual(['w1'])
    const same = addWall(doc, { x: 1, y: 1 }, { x: 1, y: 1 }, WALL, ids)
    expect(same.doc.walls).toEqual(doc.walls)
  })

  it('исходный документ не меняется', () => {
    const doc = new PlanBuilder().rect(0, 0, 1000, 1000).doc
    const frozen = JSON.stringify(doc)
    addWall(doc, { x: 500, y: -500 }, { x: 500, y: 1500 }, WALL, sequentialIds())
    expect(JSON.stringify(doc)).toBe(frozen)
  })

  it('крест: обе стены расщепляются в общей точке', () => {
    const doc = new PlanBuilder()
      .wall({ x: 0, y: 5000 }, { x: 10000, y: 5000 })
      .wall({ x: 5000, y: 0 }, { x: 5000, y: 10000 }).doc
    expect(segments(doc)).toEqual([
      '0,5000-5000,5000',
      '5000,0-5000,5000',
      '5000,5000-10000,5000',
      '5000,5000-5000,10000',
    ])
    expect(errors(doc)).toEqual([])
  })

  it('Т-примыкание: конец новой стены делит существующую', () => {
    const doc = new PlanBuilder()
      .wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
      .wall({ x: 4000, y: 0 }, { x: 4000, y: 3000 }).doc
    expect(segments(doc)).toEqual(['0,0-4000,0', '4000,0-10000,0', '4000,0-4000,3000'])
  })

  it('наложение на одной прямой: дубли сливаются, концы делят стены', () => {
    const b = new PlanBuilder().wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
    b.wall({ x: 5000, y: 0 }, { x: 15000, y: 0 })
    expect(segments(b.doc)).toEqual(['0,0-5000,0', '10000,0-15000,0', '5000,0-10000,0'])
    b.wall({ x: 10000, y: 0 }, { x: 0, y: 0 }) // поверх уже нарисованного
    expect(segments(b.doc)).toHaveLength(3)
    expect(errors(b.doc)).toEqual([])
  })

  it('происхождение: половина расщеплённой стены помнит исходную', () => {
    const base = new PlanBuilder().wall({ x: 0, y: 0 }, { x: 10000, y: 0 }).doc
    const original = Object.keys(base.walls)[0]!
    const r = addWall(base, { x: 3000, y: -1000 }, { x: 3000, y: 1000 }, WALL, sequentialIds())
    const halves = Object.keys(r.doc.walls).filter((id) => {
      const w = r.doc.walls[id]!
      return r.doc.nodes[w.a]!.y === 0 && r.doc.nodes[w.b]!.y === 0
    })
    expect(halves).toHaveLength(2)
    expect(halves).toContain(original)
    const other = halves.find((id) => id !== original)!
    expect(r.lineage[other]).toBe(original)
  })
})

describe('проёмы при правке стен', () => {
  const door = { type: 'door', heightMm: 2100, swing: 'left-in', access: 'public' } as const

  it('при расщеплении проём переезжает на часть со своей серединой', () => {
    const b = new PlanBuilder().wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
    const wall = Object.keys(b.doc.walls)[0]!
    b.opening('d1', { ...door, wallId: wall, offsetMm: 7000, widthMm: 900 })
    b.wall({ x: 5000, y: 0 }, { x: 5000, y: 3000 })
    const d = b.doc.openings.d1!
    expect(d.wallId).not.toBe(wall)
    expect(d.offsetMm).toBe(2000)
    expect(errors(b.doc)).toEqual([])
  })

  it('удаление стены паркует проём, атрибуты сохраняются', () => {
    const b = new PlanBuilder().wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
    const wall = Object.keys(b.doc.walls)[0]!
    b.opening('d1', { ...door, wallId: wall, offsetMm: 1000, widthMm: 900 })
    const { doc } = removeWall(b.doc, wall)
    expect(doc.openings.d1).toMatchObject({ wallId: null, widthMm: 900 })
    expect(Object.keys(doc.nodes)).toHaveLength(0)
    expect(validateFloor(doc).map((p) => p.code)).toEqual(['OPENING_PARKED'])
  })

  it('слияние дубликата переносит проём с пересчётом смещения', () => {
    const b = new PlanBuilder().wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
    const keep = Object.keys(b.doc.walls)[0]!
    // Вторая стена «назад» поверх первой через перенос узла.
    b.wall({ x: 0, y: 1000 }, { x: 10000, y: 1000 })
    const top = Object.keys(b.doc.walls).find((id) => id !== keep)!
    b.opening('d1', { ...door, wallId: top, offsetMm: 1000, widthMm: 900 })
    const topWall = b.doc.walls[top]!
    let doc = moveNode(b.doc, topWall.a, { x: 0, y: 0 }, b.ids).doc
    doc = moveNode(doc, topWall.b, { x: 10000, y: 0 }, b.ids).doc
    expect(Object.keys(doc.walls)).toEqual([keep])
    expect(doc.openings.d1).toMatchObject({ wallId: keep, offsetMm: 1000 })
  })
})

describe('перенос узла', () => {
  it('перенос растягивает примыкающие стены', () => {
    const b = new PlanBuilder().rect(0, 0, 4000, 4000)
    const corner = Object.entries(b.doc.nodes).find(([, n]) => n.x === 4000 && n.y === 4000)![0]
    const { doc } = moveNode(b.doc, corner, { x: 6000, y: 4000 }, b.ids)
    expect(buildFaces(doc).faces[0]!.areaMm2).toBe(20_000_000)
  })

  it('узел, переехавший через стену, расщепляет её', () => {
    const b = new PlanBuilder()
      .wall({ x: 0, y: 0 }, { x: 10000, y: 0 })
      .wall({ x: 5000, y: 2000 }, { x: 5000, y: 4000 })
    const tip = Object.entries(b.doc.nodes).find(([, n]) => n.x === 5000 && n.y === 2000)![0]
    const { doc } = moveNode(b.doc, tip, { x: 5000, y: -2000 }, b.ids)
    expect(errors(doc)).toEqual([])
    expect(segments(doc)).toEqual([
      '0,0-5000,0',
      '5000,-2000-5000,0',
      '5000,0-10000,0',
      '5000,0-5000,4000',
    ])
  })

  it('совпавшие узлы сливаются, стена между ними исчезает', () => {
    const b = new PlanBuilder()
      .wall({ x: 0, y: 0 }, { x: 1000, y: 0 })
      .wall({ x: 1000, y: 0 }, { x: 1000, y: 1000 })
    const end = Object.entries(b.doc.nodes).find(([, n]) => n.x === 0)![0]
    const { doc } = moveNode(b.doc, end, { x: 1000, y: 0 }, b.ids)
    expect(segments(doc)).toEqual(['1000,0-1000,1000'])
    expect(wallLength(doc, Object.keys(doc.walls)[0]!)).toBe(1000)
  })
})
