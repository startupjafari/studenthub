import { describe, expect, it } from 'vitest'
import {
  FloorPlanSchema,
  PlanBuilder,
  buildFaces,
  edgeCaseFixtures,
  emptyFloorPlan,
  hasErrors,
  validateFloor,
  type FloorPlanDoc,
} from '../src/index.js'

const codes = (doc: FloorPlanDoc, floorHeightMm?: number) =>
  validateFloor(doc, { floorHeightMm }).map((p) => `${p.severity}:${p.code}`)

const fx = edgeCaseFixtures()

describe('проверка этажа', () => {
  it('все фикстуры проходят схему формата', () => {
    for (const [name, doc] of Object.entries(fx)) {
      expect(FloorPlanSchema.safeParse(doc).success, name).toBe(true)
    }
  })

  it('чистые фикстуры — без ошибок', () => {
    for (const name of [
      'empty',
      'box',
      'boxWithPartition',
      'twoRoomsSharedWall',
      'roomInRoom',
      'acuteAngles',
      'crossingWalls',
      'tJunction',
      'doorAtWallEdge',
    ]) {
      expect(hasErrors(validateFloor(fx[name]!)), name).toBe(false)
    }
  })

  it('висячая стена и «ус» — предупреждения, не ошибки', () => {
    expect(codes(fx.singleWall!)).toEqual(['warning:DANGLING_WALL'])
    expect(codes(fx.tJunction!)).toEqual([
      'warning:DANGLING_WALL',
      'warning:DANGLING_WALL',
      'warning:DANGLING_WALL',
    ])
  })

  it('окно шире стены — ошибка; окно выше этажа — ошибка', () => {
    expect(codes(fx.windowWiderThanWall!)).toContain('error:OPENING_OUT_OF_WALL')
    expect(codes(fx.windowWiderThanWall!, 2000)).toContain('error:OPENING_TOO_HIGH')
  })

  it('перекрывающиеся проёмы', () => {
    const b = new PlanBuilder().rect(0, 0, 6000, 4000)
    const wall = b.wallIdAt({ x: 0, y: 0 }, { x: 6000, y: 0 })
    const door = {
      type: 'door',
      wallId: wall,
      heightMm: 2100,
      swing: 'left-in',
      access: 'public',
    } as const
    b.opening('d1', { ...door, offsetMm: 1000, widthMm: 900 }).opening('d2', {
      ...door,
      offsetMm: 1500,
      widthMm: 900,
    })
    expect(codes(b.doc)).toEqual(['error:OPENINGS_OVERLAP'])
  })

  it('сломанные ссылки, дубли узлов и стен, нулевая и короткая стена', () => {
    const doc: FloorPlanDoc = {
      ...emptyFloorPlan(),
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 0, y: 0 }, n3: { x: 30, y: 0 }, n4: { x: 5000, y: 0 } },
      walls: {
        w1: { a: 'n1', b: 'nX', thicknessMm: 200, kind: 'wall' },
        w2: { a: 'n1', b: 'n2', thicknessMm: 200, kind: 'wall' },
        w3: { a: 'n1', b: 'n3', thicknessMm: 200, kind: 'wall' },
        w4: { a: 'n3', b: 'n1', thicknessMm: 200, kind: 'wall' },
        w5: { a: 'n3', b: 'n4', thicknessMm: 200, kind: 'wall' },
      },
    }
    const c = codes(doc)
    for (const code of [
      'error:DUPLICATE_NODE',
      'error:BROKEN_REF',
      'error:ZERO_LENGTH_WALL',
      'error:DUPLICATE_WALL',
      'warning:SHORT_WALL',
    ]) {
      expect(c).toContain(code)
    }
  })

  it('пересечение без общего узла — ошибка планарности', () => {
    const doc: FloorPlanDoc = {
      ...emptyFloorPlan(),
      nodes: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 0, y: 10 }, d: { x: 10, y: 0 } },
      walls: {
        w1: { a: 'a', b: 'b', thicknessMm: 200, kind: 'wall' },
        w2: { a: 'c', b: 'd', thicknessMm: 200, kind: 'wall' },
      },
    }
    expect(codes(doc)).toContain('error:NOT_PLANAR')
  })

  it('помещения: маленькое, без Room у учебного, дубль Room, потерянное, метка снаружи', () => {
    const b = new PlanBuilder().rect(0, 0, 600, 600).rect(5000, 0, 6000, 6000)
    const [tiny, big] = buildFaces(b.doc).faces.sort((f, g) => f.areaMm2 - g.areaMm2)
    const room = '22222222-2222-4222-8222-222222222222'
    const doc: FloorPlanDoc = {
      ...b.doc,
      spaces: {
        s1: {
          label: { x: 300, y: 300 },
          edges: tiny!.wallIds,
          kind: 'storage',
          visibility: 'hidden',
          roomId: room,
        },
        s2: {
          label: { x: 9000, y: 9000 },
          edges: big!.wallIds,
          kind: 'auditorium',
          visibility: 'public',
        },
        s3: {
          label: { x: 1, y: 1 },
          edges: ['gone'],
          kind: 'office',
          visibility: 'public',
          roomId: room,
        },
      },
    }
    const c = codes(doc)
    expect(c).toContain('warning:SPACE_TOO_SMALL')
    expect(c).toContain('warning:SPACE_LABEL_OUTSIDE')
    expect(c).toContain('error:ROOM_REQUIRED')
    expect(c).toContain('error:DUPLICATE_ROOM')
    expect(c).toContain('error:SPACE_LOST')
  })

  it('вырожденная лестница', () => {
    const doc: FloorPlanDoc = {
      ...emptyFloorPlan(),
      verticals: {
        v1: {
          type: 'stairs',
          groupId: 'A',
          outline: [
            [0, 0],
            [1000, 0],
            [2000, 0],
          ],
          stepFree: false,
          landing: { x: 0, y: 0 },
        },
      },
    }
    expect(codes(doc)).toEqual(['error:VERTICAL_DEGENERATE'])
  })
})

describe('схема формата', () => {
  it('координаты — целые миллиметры в пределах ±10 км', () => {
    const bad = { ...emptyFloorPlan(), nodes: { n1: { x: 0.5, y: 0 } } }
    expect(FloorPlanSchema.safeParse(bad).success).toBe(false)
    const far = { ...emptyFloorPlan(), nodes: { n1: { x: 10_000_001, y: 0 } } }
    expect(FloorPlanSchema.safeParse(far).success).toBe(false)
  })

  it('связь с Room — uuid; чужие поля запрещены', () => {
    const base = new PlanBuilder().rect(0, 0, 1000, 1000).doc
    const space = { label: { x: 500, y: 500 }, edges: [], kind: 'office', visibility: 'public' }
    expect(
      FloorPlanSchema.safeParse({ ...base, spaces: { s: { ...space, roomId: 'x' } } }).success,
    ).toBe(false)
    expect(
      FloorPlanSchema.safeParse({ ...base, spaces: { s: { ...space, extra: 1 } } }).success,
    ).toBe(false)
    expect(FloorPlanSchema.safeParse({ ...base, spaces: { s: space } }).success).toBe(true)
  })
})
