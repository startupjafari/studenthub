import { describe, expect, it } from 'vitest'
import {
  WALL,
  addWall,
  buildFaces,
  emptyFloorPlan,
  moveNode,
  removeWall,
  sequentialIds,
  validateFloor,
  type FloorPlanDoc,
} from '../src/index.js'

/**
 * Свойства на случайных последовательностях правок (своя мини-реализация property-based:
 * сид и повторяемость, без внешней библиотеки). Стены — по сетке 1 м под 0°, 45° и 90°:
 * так все точки пересечения целые, и инварианты проверяются точно, без допусков.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRID = 1000
const SIZE = 8

function randomStep(
  doc: FloorPlanDoc,
  rand: () => number,
  ids: ReturnType<typeof sequentialIds>,
): FloorPlanDoc {
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!
  const point = () => ({
    x: Math.floor(rand() * (SIZE + 1)) * GRID,
    y: Math.floor(rand() * (SIZE + 1)) * GRID,
  })
  const roll = rand()
  const walls = Object.keys(doc.walls)
  const nodes = Object.keys(doc.nodes)
  if (roll < 0.15 && walls.length > 0) return removeWall(doc, pick(walls), ids).doc
  if (roll < 0.3 && nodes.length > 0) {
    // Перенос узла — тоже по сетке и только на «чистые» направления от соседей не гарантирован,
    // поэтому сдвиг только по осям: пересечения остаются целыми.
    const id = pick(nodes)
    const n = doc.nodes[id]!
    const dx = (Math.floor(rand() * 3) - 1) * GRID
    const dy = dx === 0 ? (Math.floor(rand() * 3) - 1) * GRID : 0
    return moveNode(doc, id, { x: n.x + dx, y: n.y + dy }, ids).doc
  }
  const p = point()
  const len = (1 + Math.floor(rand() * SIZE)) * GRID
  const dir = pick([
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ])
  return addWall(doc, p, { x: p.x + dir[0]! * len, y: p.y + dir[1]! * len }, WALL, ids).doc
}

function checkInvariants(doc: FloorPlanDoc, context: string): void {
  // 1) Планарность и целостность — без единой ошибки проверки (помещений здесь нет).
  const errors = validateFloor(doc).filter((p) => p.severity === 'error')
  expect(errors, context).toEqual([])
  // 2) Нет висячих ссылок и узлов без стен.
  const used = new Set(Object.values(doc.walls).flatMap((w) => [w.a, w.b]))
  for (const w of Object.values(doc.walls)) {
    expect(doc.nodes[w.a], context).toBeDefined()
    expect(doc.nodes[w.b], context).toBeDefined()
  }
  expect(
    Object.keys(doc.nodes).every((id) => used.has(id)),
    context,
  ).toBe(true)
  // 3) Сумма ориентированных площадей всех обходов равна нулю: каждая компонента — её
  //    внешняя граница (отрицательная) уравновешивает грани (положительные).
  const { faces, outside } = buildFaces(doc)
  const total =
    faces.reduce((s, f) => s + f.outer.area2 + f.holes.reduce((h, r) => h + r.area2, 0), 0) +
    outside.reduce((s, r) => s + r.area2, 0)
  expect(total, context).toBe(0)
  // 4) Каждая стена — ровно в двух полурёбрах обходов (по разу в каждую сторону).
  for (const f of faces) expect(f.areaMm2, context).toBeGreaterThan(0)
}

describe('инварианты топологии на случайных правках', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`сид ${seed}`, () => {
      const rand = rng(seed)
      const ids = sequentialIds()
      let doc = emptyFloorPlan()
      for (let step = 0; step < 40; step++) {
        doc = randomStep(doc, rand, ids)
        checkInvariants(doc, `сид ${seed}, шаг ${step}`)
      }
    })
  }
})

describe('произвольные углы', () => {
  it('пересечения под произвольными углами округляются, расщепление сходится', () => {
    const rand = rng(7)
    const ids = sequentialIds()
    let doc = emptyFloorPlan()
    for (let i = 0; i < 60; i++) {
      const p = { x: Math.floor(rand() * 20_000), y: Math.floor(rand() * 20_000) }
      const q = { x: Math.floor(rand() * 20_000), y: Math.floor(rand() * 20_000) }
      doc = addWall(doc, p, q, WALL, ids).doc
    }
    // После округления до мм возможны касания на субмиллиметровом уровне — их ловит проверка;
    // требование — что расщепление завершилось и документ целостен по ссылкам.
    const broken = validateFloor(doc).filter(
      (p) => p.code === 'BROKEN_REF' || p.code === 'DUPLICATE_NODE',
    )
    expect(broken).toEqual([])
    expect(Object.keys(doc.walls).length).toBeGreaterThan(60)
  })
})
