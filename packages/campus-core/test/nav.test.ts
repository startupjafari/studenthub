import { describe, expect, it } from 'vitest'
import {
  buildNavGraph,
  explainNoRoute,
  graphForViewer,
  indexGraph,
  nodePoint,
  routeBetweenSpaces,
  routeSteps,
  type NavFloorInput,
} from '../src/nav/index.js'
import { generateCampus, generateFloor } from '../src/fixtures/generate.js'
import type { FloorPlanDoc } from '../src/format/schema.js'

const T0 = { x: 0, y: 0, rotationDeg: 0 }

function floors(
  levels: number,
  rooms = 4,
  code = 'А',
  transform = T0,
  buildingId = 'b1',
): NavFloorInput[] {
  return Array.from({ length: levels }, (_, i) => ({
    floorId: `${buildingId}-f${i + 1}`,
    buildingId,
    elevationMm: i * 3300,
    doc: generateFloor({ roomsPerSide: rooms, buildingCode: code, level: i + 1 }),
    transform,
  }))
}

describe('навигация: один этаж', () => {
  const [f] = floors(1)
  const index = indexGraph(buildNavGraph([f!]))

  it('из любой комнаты в любую через коридор', () => {
    const route = routeBetweenSpaces(index, 's_А102', 's_А107')
    expect(route).not.toBeNull()
    // Путь проходит через двери обеих комнат.
    const kinds = route!.nodes.map((n) => nodePoint(index.graph, n).kind)
    expect(kinds.filter((k) => k === 'portal').length).toBeGreaterThanOrEqual(4)
    // Не короче прямой и не длиннее разумного обхода.
    expect(route!.distanceMm).toBeGreaterThan(5_000)
    expect(route!.distanceMm).toBeLessThan(40_000)
  })

  it('путь не проходит сквозь стены: каждое ребро — внутри одной грани или через дверь', () => {
    const route = routeBetweenSpaces(index, 's_А101', 's_А108')!
    for (let i = 1; i < route.nodes.length; i++) {
      const a = nodePoint(index.graph, route.nodes[i - 1]!)
      const b = nodePoint(index.graph, route.nodes[i]!)
      // Через перегородку между соседними комнатами (x = 6000) проходить нельзя, если обе
      // точки по разные стороны в нижнем ряду.
      const crossesPartition = a.y < 7000 && b.y < 7000 && (a.x - 6000) * (b.x - 6000) < 0
      expect(crossesPartition).toBe(false)
    }
  })

  it('без двери — причина NO_DOOR', () => {
    const doc: FloorPlanDoc = {
      ...f!.doc,
      openings: Object.fromEntries(Object.entries(f!.doc.openings).slice(1)),
    }
    const idx = indexGraph(buildNavGraph([{ ...f!, doc }]))
    // Первая дверь — у комнаты А101.
    expect(routeBetweenSpaces(idx, 's_А101', 's_А103')).toBeNull()
    expect(explainNoRoute(idx, 's_А101', 's_А103')).toBe('NO_DOOR')
  })

  it('служебная дверь: сотруднику можно, остальным — ACCESS_RESTRICTED', () => {
    const doc: FloorPlanDoc = {
      ...f!.doc,
      openings: Object.fromEntries(
        Object.entries(f!.doc.openings).map(([id, o], i) =>
          i === 1 && o.type === 'door' ? [id, { ...o, access: 'staff' as const }] : [id, o],
        ),
      ),
    }
    const g = buildNavGraph([{ ...f!, doc }])
    const target = Object.values(g.spaces).find((s) => s === 's_А105')!
    const staffIdx = indexGraph(g)
    const pub = indexGraph(graphForViewer(g, new Set(Object.values(g.spaces)), false))
    // Вторая дверь — у комнаты верхнего ряда А105.
    expect(routeBetweenSpaces(staffIdx, 's_А102', target, { staff: true })).not.toBeNull()
    expect(routeBetweenSpaces(pub, 's_А102', target)).toBeNull()
    expect(explainNoRoute(pub, 's_А102', target)).toBe('ACCESS_RESTRICTED')
  })

  it('неизвестное помещение и отсутствие графа', () => {
    expect(explainNoRoute(index, 's_А101', 'нет')).toBe('UNKNOWN_SPACE')
    expect(explainNoRoute(null, 's_А101', 's_А102')).toBe('NO_GRAPH')
  })
})

describe('навигация: этажи и корпуса', () => {
  it('на другой этаж — по лестнице, шаг «подняться»', () => {
    const fs = floors(3)
    const index = indexGraph(buildNavGraph(fs))
    // Номера на этажах: А1xx и А3xx — разные документы, но id помещений совпадают; адресуем узлом.
    const g = index.graph
    const node = (floor: string, space: string) =>
      Number(
        Object.entries(g.spaces).find(
          ([n, s]) => s === space && nodePoint(g, Number(n)).floor === floor,
        )![0],
      )
    const from = node('b1-f1', 's_А102')
    const to = node('b1-f3', 's_А303')
    const route = routeBetweenSpaces(
      {
        ...index,
        nodeBySpace: new Map([
          ['a', from],
          ['b', to],
        ]),
      },
      'a',
      'b',
    )
    expect(route).not.toBeNull()
    const steps = routeSteps(index, route!)
    const vertical = steps.find((s) => s.type === 'vertical')
    expect(vertical).toMatchObject({ type: 'vertical', via: 'stairs', toFloor: 'b1-f3', up: true })
    // Лестница без пандуса: в профиле «без ступеней» пути нет.
    const sf = {
      ...index,
      nodeBySpace: new Map([
        ['a', from],
        ['b', to],
      ]),
    }
    expect(routeBetweenSpaces(sf, 'a', 'b', { stepFree: true })).toBeNull()
    expect(explainNoRoute(sf, 'a', 'b', { stepFree: true })).toBe('STEP_FREE_UNAVAILABLE')
  })

  it('лифт делает путь доступным без ступеней', () => {
    const fs = floors(2).map((f) => ({
      ...f,
      doc: {
        ...f.doc,
        verticals: {
          ...f.doc.verticals,
          lift: {
            ...f.doc.verticals['v_R']!,
            type: 'elevator' as const,
            groupId: 'lift',
            stepFree: true,
          },
        },
      },
    }))
    const index = indexGraph(buildNavGraph(fs))
    const g = index.graph
    const node = (floor: string, space: string) =>
      Number(
        Object.entries(g.spaces).find(
          ([n, s]) => s === space && nodePoint(g, Number(n)).floor === floor,
        )![0],
      )
    const sf = {
      ...index,
      nodeBySpace: new Map([
        ['a', node('b1-f1', 's_А102')],
        ['b', node('b1-f2', 's_А202')],
      ]),
    }
    const route = routeBetweenSpaces(sf, 'a', 'b', { stepFree: true })
    expect(route).not.toBeNull()
    expect(
      routeSteps(index, route!).some((s) => s.type === 'vertical' && s.via === 'elevator'),
    ).toBe(true)
  })

  it('между корпусами — через входы по улице', () => {
    const campus = generateCampus({ buildings: 2, floors: 1, roomsPerSide: 4, seed: 2 })
    const inputs: NavFloorInput[] = campus.buildings.map((b) => ({
      floorId: `${b.id}-1`,
      buildingId: b.id,
      elevationMm: 0,
      doc: b.floors[0]!.doc,
      transform: b.transform,
    }))
    const index = indexGraph(buildNavGraph(inputs))
    const g = index.graph
    const pick = (floor: string) =>
      Number(
        Object.entries(g.spaces).find(
          ([n, s]) =>
            s.startsWith('s_') && s !== 's_corridor' && nodePoint(g, Number(n)).floor === floor,
        )![0],
      )
    const sf = {
      ...index,
      nodeBySpace: new Map([
        ['a', pick('b1-1')],
        ['b', pick('b2-1')],
      ]),
    }
    const route = routeBetweenSpaces(sf, 'a', 'b')
    expect(route).not.toBeNull()
    const steps = routeSteps(index, route!)
    expect(steps.map((s) => s.type)).toEqual(['start', 'exit', 'enter', 'arrive'])
    expect(route!.nodes.some((n) => nodePoint(g, n).kind === 'entrance')).toBe(true)
  })

  it('граф кампуса 5 × 5 строится быстро и компактно', () => {
    const campus = generateCampus({ buildings: 5, floors: 5, roomsPerSide: 15, seed: 3 })
    const inputs: NavFloorInput[] = campus.buildings.flatMap((b) =>
      b.floors.map((f) => ({
        floorId: `${b.id}-${f.level}`,
        buildingId: b.id,
        elevationMm: (f.level - 1) * 3300,
        doc: f.doc,
        transform: b.transform,
      })),
    )
    const t = performance.now()
    const g = buildNavGraph(inputs)
    const ms = performance.now() - t
    expect(ms).toBeLessThan(5_000)
    expect(JSON.stringify(g).length).toBeLessThan(5_000_000)
    const index = indexGraph(g)
    const ids = Object.keys(g.spaces).map(Number)
    const t2 = performance.now()
    const route = routeBetweenSpaces(
      {
        ...index,
        nodeBySpace: new Map([
          ['a', ids[0]!],
          ['b', ids.at(-1)!],
        ]),
      },
      'a',
      'b',
    )
    expect(performance.now() - t2).toBeLessThan(200)
    expect(route).not.toBeNull()
  })
})
