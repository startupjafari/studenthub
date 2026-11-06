import { bench, describe } from 'vitest'
import { generateCampus, generateFloor } from '../src/fixtures/generate.js'
import { buildFaces } from '../src/topology/faces.js'
import { validateFloor } from '../src/validate/floor.js'
import { matchSpaces } from '../src/topology/match-spaces.js'
import { floorMesh } from '../src/mesh/floor-mesh.js'
import { buildNavGraph, findRoute, indexGraph, type NavFloorInput } from '../src/nav/index.js'

/**
 * Бенчмарк сценариев §21.1 (задача 22.31): `pnpm --filter @studenthub/campus-core bench`.
 * Этаж на 40 комнат с каждой стороны — крупный учебный корпус; кампус 20 × 10 — потолок
 * сценария «большой вуз».
 */
const floor = generateFloor({ roomsPerSide: 40 })

describe('этаж 2 × 40 комнат', () => {
  bench('грани', () => {
    buildFaces(floor)
  })
  bench('проверка', () => {
    validateFloor(floor)
  })
  bench('сопоставление помещений', () => {
    matchSpaces(floor)
  })
  bench('3D-геометрия', () => {
    floorMesh(floor, { elevationMm: 0, heightMm: 3300 })
  })
})

const campus = generateCampus({ buildings: 20, floors: 10, roomsPerSide: 20, seed: 1 })
const inputs: NavFloorInput[] = campus.buildings.flatMap((b) =>
  b.floors.map((f) => ({
    floorId: `${b.id}-${f.level}`,
    buildingId: b.id,
    elevationMm: (f.level - 1) * 3300,
    doc: f.doc,
    transform: b.transform,
  })),
)
const graph = buildNavGraph(inputs)
const index = indexGraph(graph)
// Узлы, а не id помещений: у синтетики id коридоров на этажах совпадают.
const ends = Object.keys(graph.spaces).map(Number)

describe('кампус 20 × 10', () => {
  bench(
    'навигационный граф (публикация)',
    () => {
      buildNavGraph(inputs)
    },
    { iterations: 3 },
  )
  bench('маршрут через весь кампус (A*)', () => {
    findRoute(index, ends[0]!, ends.at(-1)!)
  })
})
