import { describe, expect, it } from 'vitest'
import { floorMesh, slabMesh, type MeshBuffers } from '../src/mesh/index.js'
import { generateFloor } from '../src/fixtures/generate.js'
import { PlanBuilder } from '../src/fixtures/edge-cases.js'

/** Каждый треугольник смотрит туда же, куда его нормаль (лицевая сторона по CCW). */
function facingOk(m: MeshBuffers): boolean {
  const p = m.positions
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!]
    const ux = p[b * 3]! - p[a * 3]!
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!
    const vx = p[c * 3]! - p[a * 3]!
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    const n = m.normals
    const dot = cx * n[a * 3]! + cy * n[a * 3 + 1]! + cz * n[a * 3 + 2]!
    if (dot <= 0) return false
  }
  return true
}

describe('floorMesh', () => {
  const room = new PlanBuilder().rect(0, 0, 6000, 4000).doc

  it('стены, пол и единая ориентация граней', () => {
    const m = floorMesh(room, { elevationMm: 0, heightMm: 3000 })
    expect(m.walls.indices.length).toBeGreaterThan(0)
    expect(facingOk(m.walls)).toBe(true)
    for (const f of Object.values(m.floors)) expect(facingOk(f!)).toBe(true)
  })

  it('дверь вырезает проём: перемычка вместо стены', () => {
    const wallId = Object.keys(room.walls)[0]!
    const withDoor = {
      ...room,
      openings: {
        o1: {
          type: 'door' as const,
          wallId,
          offsetMm: 1000,
          widthMm: 900,
          heightMm: 2100,
          swing: 'left-in' as const,
          access: 'public' as const,
        },
      },
    }
    const plain = floorMesh(room, { elevationMm: 0, heightMm: 3000 })
    const cut = floorMesh(withDoor, { elevationMm: 0, heightMm: 3000 })
    expect(cut.walls.indices.length).toBeGreaterThan(plain.walls.indices.length)
    expect(facingOk(cut.walls)).toBe(true)
    // Ни одна вершина стены не лежит внутри проёма ниже перемычки.
    const p = cut.walls.positions
    let inside = 0
    const w = room.walls[wallId]!
    const a = room.nodes[w.a]!
    const b = room.nodes[w.b]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]! * 1000
      const y = -p[i + 2]! * 1000
      const along = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / len
      const across = Math.abs(((x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)) / len)
      if (along > 1010 && along < 1890 && across < 100 && p[i + 1]! < 2.0) inside += 1
    }
    expect(inside).toBe(0)
  })

  it('окно даёт стекло', () => {
    const wallId = Object.keys(room.walls)[0]!
    const m = floorMesh(
      {
        ...room,
        openings: {
          o1: {
            type: 'window',
            wallId,
            offsetMm: 1000,
            widthMm: 1500,
            heightMm: 1500,
            sillMm: 900,
          },
        },
      },
      { elevationMm: 0, heightMm: 3000 },
    )
    expect(m.glass.indices.length).toBeGreaterThan(0)
  })

  it('высота этажа поднимает геометрию', () => {
    const m = floorMesh(room, { elevationMm: 3300, heightMm: 3000 })
    let min = Infinity
    for (let i = 1; i < m.walls.positions.length; i += 3) min = Math.min(min, m.walls.positions[i]!)
    expect(min).toBeCloseTo(3.3, 5)
  })

  it('большой этаж собирается быстро', () => {
    const doc = generateFloor({ roomsPerSide: 40 })
    const t = performance.now()
    const m = floorMesh(doc, { elevationMm: 0, heightMm: 3300 })
    expect(performance.now() - t).toBeLessThan(2000)
    expect(facingOk(m.walls)).toBe(true)
  })
})

describe('floorMesh — лестницы и лифты', () => {
  const room = new PlanBuilder().rect(0, 0, 6000, 4000).doc
  const doc = {
    ...room,
    verticals: {
      st: {
        type: 'stairs' as const,
        groupId: 'g1',
        outline: [
          [500, 500],
          [4500, 500],
          [4500, 1700],
          [500, 1700],
        ] as [number, number][],
        stepFree: false,
        landing: { x: 300, y: 1100 },
      },
      el: {
        type: 'elevator' as const,
        groupId: 'g2',
        outline: [
          [4800, 2500],
          [5800, 2500],
          [5800, 3800],
          [4800, 3800],
        ] as [number, number][],
        stepFree: true,
        landing: { x: 5300, y: 2300 },
      },
    },
  }
  const m = floorMesh(doc, { elevationMm: 0, heightMm: 3000 })
  const ys = (b: MeshBuffers): number[] => [...b.positions].filter((_, i) => i % 3 === 1)
  const xsAtTop = (b: MeshBuffers, y: number): number[] =>
    [...b.positions].flatMap((v, i, all) =>
      i % 3 === 0 && Math.abs(all[i + 1]! - y) < 1e-6 ? [v] : [],
    )

  it('лестница двухмаршевая — площадка на полвысоты у дальнего края, верх у площадки', () => {
    expect(m.stairs.indices.length).toBeGreaterThan(0)
    expect(facingOk(m.stairs)).toBe(true)
    expect(Math.max(...ys(m.stairs))).toBeCloseTo(3, 5)
    // Промежуточная площадка — на половине высоты, у дальнего от площадки края (x = 4,5 м).
    expect(Math.max(...xsAtTop(m.stairs, 1.5))).toBeCloseTo(4.5, 5)
    // Второй марш приходит обратно к краю у площадки (x = 0,5 м) — к этажной площадке.
    expect(Math.max(...xsAtTop(m.stairs, 3))).toBeLessThan(2)
    // Этажная площадка у входа (0,5…1,3 м) — пол, ступеней на ней нет.
    const xs = [...m.stairs.positions].filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs)).toBeGreaterThan(1.25)
  })

  it('проём в полу — над лестницей с этажа ниже пола нет', () => {
    const hall = new PlanBuilder().rect(0, 0, 6000, 4000).doc
    const area = (b: MeshBuffers): number => {
      let sum = 0
      const p = b.positions
      for (let i = 0; i < b.indices.length; i += 3) {
        const [a, c, d] = [b.indices[i]!, b.indices[i + 1]!, b.indices[i + 2]!]
        const ux = p[c * 3]! - p[a * 3]!
        const uz = p[c * 3 + 2]! - p[a * 3 + 2]!
        const vx = p[d * 3]! - p[a * 3]!
        const vz = p[d * 3 + 2]! - p[a * 3 + 2]!
        sum += Math.abs(ux * vz - uz * vx) / 2
      }
      return sum
    }
    const floorArea = (o: Parameters<typeof floorMesh>[1]): number =>
      Object.values(floorMesh(hall, o).floors).reduce((s, b) => s + area(b!), 0)
    const whole = floorArea({ elevationMm: 0, heightMm: 3000 })
    const cut = floorArea({
      elevationMm: 0,
      heightMm: 3000,
      openings: [
        [
          { x: 1000, y: 1000 },
          { x: 3000, y: 1000 },
          { x: 3000, y: 2000 },
          { x: 1000, y: 2000 },
        ],
      ],
    })
    expect(whole - cut).toBeCloseTo(2, 3)
  })

  it('лифт — шахта на всю высоту этажа', () => {
    expect(facingOk(m.elevators)).toBe(true)
    expect(Math.min(...ys(m.elevators))).toBeCloseTo(0, 5)
    expect(Math.max(...ys(m.elevators))).toBeCloseTo(3, 5)
  })

  it('разрез этажа срезает и лестницы с лифтами', () => {
    const cut = floorMesh(doc, { elevationMm: 0, heightMm: 3000, cutHeightMm: 1200 })
    expect(Math.max(...ys(cut.stairs))).toBeCloseTo(1.2, 5)
    expect(Math.max(...ys(cut.elevators))).toBeCloseTo(1.2, 5)
  })
})

describe('slabMesh', () => {
  it('плита смотрит вверх и наружу', () => {
    const m = slabMesh(
      [
        { x: 0, y: 0 },
        { x: 10_000, y: 0 },
        { x: 10_000, y: 5_000 },
        { x: 0, y: 5_000 },
      ],
      0,
      200,
    )
    expect(facingOk(m)).toBe(true)
  })

  it('проём в плите — дыра и торцы, смотрящие в проём', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
      { x: 10_000, y: 5_000 },
      { x: 0, y: 5_000 },
    ]
    const hole = [
      { x: 2_000, y: 1_000 },
      { x: 4_000, y: 1_000 },
      { x: 4_000, y: 3_000 },
      { x: 2_000, y: 3_000 },
    ]
    const plain = slabMesh(outline, 0, 200)
    const m = slabMesh(outline, 0, 200, undefined, [hole])
    expect(facingOk(m)).toBe(true)
    // Четыре торца проёма — по два треугольника; плюс сам верх стал сложнее.
    expect(m.indices.length).toBeGreaterThan(plain.indices.length + 4 * 6)
  })
})

describe('spaceHighlightMesh', () => {
  it('подсветка находит грань помещения', async () => {
    const { spaceHighlightMesh } = await import('../src/mesh/index.js')
    const doc = generateFloor({ roomsPerSide: 3 })
    const id = Object.keys(doc.spaces)[0]!
    const m = spaceHighlightMesh(doc, id, { elevationMm: 0, heightMm: 3000 })
    expect(m && m.indices.length).toBeGreaterThan(0)
    expect(spaceHighlightMesh(doc, 'нет', { elevationMm: 0, heightMm: 3000 })).toBeNull()
  })
})
