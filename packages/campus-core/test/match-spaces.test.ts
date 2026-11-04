import { describe, expect, it } from 'vitest'
import {
  PlanBuilder,
  WALL,
  addWall,
  buildFaces,
  faceContains,
  matchSpaces,
  moveNode,
  removeWall,
  type FloorPlanDoc,
  type PlanSpace,
} from '../src/index.js'

const ROOM_A = '11111111-1111-4111-8111-111111111111'

/** Помещение по точке метки: стены — грани, где лежит метка (как при «Создать помещение»). */
function withSpace(
  doc: FloorPlanDoc,
  id: string,
  label: { x: number; y: number },
  extra: Partial<PlanSpace> = {},
) {
  const face = buildFaces(doc).faces.find((f) => faceContains(f, label))!
  const space: PlanSpace = {
    label,
    edges: [...face.wallIds],
    kind: 'auditorium',
    visibility: 'public',
    number: id,
    ...extra,
  }
  return { ...doc, spaces: { ...doc.spaces, [id]: space } }
}

describe('помещения переживают правку стен', () => {
  it('перенос стены: то же помещение, рёбра и метка на месте', () => {
    const b = new PlanBuilder().rect(0, 0, 6000, 8000)
    const doc = withSpace(b.doc, 's305', { x: 3000, y: 4000 }, { roomId: ROOM_A })
    const corner = Object.entries(doc.nodes).find(([, n]) => n.x === 6000 && n.y === 8000)![0]
    const moved = moveNode(doc, corner, { x: 9000, y: 8000 }, b.ids)
    const r = matchSpaces(moved.doc, moved.lineage)
    expect(r.lost).toEqual([])
    expect(r.unassignedFaces).toEqual([])
    expect(r.doc.spaces.s305).toMatchObject({ roomId: ROOM_A, number: 's305' })
  })

  it('разделили перегородкой: id у части с меткой, вторая — «без назначения»', () => {
    const b = new PlanBuilder().rect(0, 0, 12000, 8000)
    const doc = withSpace(b.doc, 's1', { x: 9000, y: 4000 })
    const split = addWall(doc, { x: 6000, y: 0 }, { x: 6000, y: 8000 }, WALL, b.ids)
    const r = matchSpaces(split.doc, split.lineage)
    expect(r.lost).toEqual([])
    expect(r.unassignedFaces).toHaveLength(1)
    const face = buildFaces(r.doc).faces.find((f) => f.id === r.assignments.s1)!
    expect(faceContains(face, { x: 9000, y: 4000 })).toBe(true)
  })

  it('убрали стену между двумя: id у помещения с большим числом стен, второе потеряно', () => {
    // Слева — комната с «эркером» (больше стен), справа — простая.
    const b = new PlanBuilder()
      .loop([
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 8000 },
        { x: 0, y: 8000 },
        { x: 0, y: 5000 },
        { x: -1000, y: 5000 },
        { x: -1000, y: 3000 },
        { x: 0, y: 3000 },
      ])
      .rect(6000, 0, 6000, 8000)
    let doc = withSpace(b.doc, 'big', { x: 3000, y: 4000 })
    doc = withSpace(doc, 'small', { x: 9000, y: 4000 })
    const shared = Object.entries(doc.walls).find(
      ([, w]) => doc.nodes[w.a]!.x === 6000 && doc.nodes[w.b]!.x === 6000,
    )![0]
    const r = matchSpaces(removeWall(doc, shared, b.ids).doc)
    expect(Object.keys(r.assignments)).toEqual(['big'])
    expect(r.lost).toEqual(['small'])
    // Атрибуты потерянного не стёрты — их можно перенести вручную.
    expect(r.doc.spaces.small?.number).toBe('small')
  })

  it('метка, выпавшая из помещения, переезжает внутрь', () => {
    const b = new PlanBuilder().rect(0, 0, 10000, 10000)
    const doc = withSpace(b.doc, 's1', { x: 9000, y: 9000 })
    const corner = Object.entries(doc.nodes).find(([, n]) => n.x === 10000 && n.y === 10000)![0]
    const moved = moveNode(doc, corner, { x: 5000, y: 5000 }, b.ids)
    const r = matchSpaces(moved.doc, moved.lineage)
    const face = buildFaces(r.doc).faces[0]!
    expect(r.assignments.s1).toBe(face.id)
    expect(faceContains(face, r.doc.spaces.s1!.label)).toBe(true)
  })

  it('грань целиком разобрана — помещение потеряно', () => {
    const b = new PlanBuilder().rect(0, 0, 4000, 4000)
    let doc = withSpace(b.doc, 's1', { x: 2000, y: 2000 })
    doc = removeWall(doc, Object.keys(doc.walls)[0]!, b.ids).doc
    expect(matchSpaces(doc).lost).toEqual(['s1'])
  })
})
