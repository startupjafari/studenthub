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
