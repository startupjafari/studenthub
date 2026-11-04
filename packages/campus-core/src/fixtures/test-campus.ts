import type { FloorPlanDoc, PlanSpace } from '../format/schema.js'
import { SITE_PLAN_FORMAT, type SitePlanDoc } from '../format/site.js'
import type { Pt } from '../geom/int.js'
import type { BuildingTransform } from '../topology/building.js'
import { generateFloor } from './generate.js'

/**
 * Тестовый кампус (docs/CAMPUS_BUILDER.md §22.1, решение владельца: пилотных планов нет —
 * эталон свой). Три корпуса на территории с дорожками; каждый закрывает типовой случай:
 *  - А, учебный (1–3): коридорная система, лестницы в торцах и лифт без ступеней;
 *  - Б, лекционный (1–5): пятый этаж технический — обычным зрителям не показывается;
 *  - В, библиотека (1–2): книгохранилище только для сотрудников, щитовая скрыта.
 * Детерминирован: одинаковый вызов — одинаковые документы, тесты и демо сравнимы.
 */
export interface TestCampusFloor {
  level: number
  label: string
  kind: 'regular' | 'technical'
  heightMm: number
  doc: FloorPlanDoc
}

export interface TestCampusBuilding {
  code: string
  name: string
  outline: Pt[]
  transform: BuildingTransform
  floors: TestCampusFloor[]
}

export interface TestCampus {
  buildings: TestCampusBuilding[]
  site: SitePlanDoc
}

const ROOM_W = 6000
const DEPTH = 2 * 7000 + 2400
const ENTRANCE_Y = 7000 + 1200

/** Id помещений уникальны на весь кампус: индекс версии хранит их одним ключом. */
function uniqueSpaceIds(doc: FloorPlanDoc, prefix: string): FloorPlanDoc {
  const spaces: Record<string, PlanSpace> = {}
  for (const [id, s] of Object.entries(doc.spaces)) {
    spaces[id === 's_corridor' ? `s_${prefix}_corridor` : id] = s
  }
  // Лестницы одного корпуса связывает groupId; у разных корпусов они разные.
  return { ...doc, spaces }
}

function floorOf(code: string, level: number, rooms: number): FloorPlanDoc {
  return uniqueSpaceIds(
    generateFloor({ roomsPerSide: rooms, buildingCode: code, level }),
    `${code}${level}`,
  )
}

/** Лифт в предпоследней комнате нижнего ряда: помещение становится лифтовым холлом. */
function withElevator(doc: FloorPlanDoc, code: string, level: number, rooms: number): FloorPlanDoc {
  const index = rooms - 2
  const number = `${code}${level}${String(index + 1).padStart(2, '0')}`
  const spaceId = `s_${number}`
  const space = doc.spaces[spaceId]
  if (!space) return doc
  const x0 = index * ROOM_W
  const { roomId: _roomId, capacity: _capacity, ...rest } = space
  return {
    ...doc,
    spaces: { ...doc.spaces, [spaceId]: { ...rest, kind: 'elevator_hall', name: 'Лифт' } },
    verticals: {
      ...doc.verticals,
      v_lift: {
        type: 'elevator',
        groupId: `${code}-lift`,
        outline: [
          [x0 + 1500, 1000],
          [x0 + 4500, 1000],
          [x0 + 4500, 4000],
          [x0 + 1500, 4000],
        ],
        stepFree: true,
        landing: { x: x0 + 3000, y: 5500 },
      },
    },
  }
}

/** Видимость и назначения библиотеки: читальный зал, книгохранилище (staff), щитовая (hidden). */
function libraryFloor(doc: FloorPlanDoc, level: number): FloorPlanDoc {
  const spaces = { ...doc.spaces }
  const patch = (n: number, p: Partial<PlanSpace>): void => {
    const id = `s_В${level}${String(n).padStart(2, '0')}`
    const s = spaces[id]
    if (!s) return
    const { roomId: _roomId, capacity: _capacity, ...rest } = s
    spaces[id] = { ...rest, ...p } as PlanSpace
  }
  patch(2, { kind: 'library', name: 'Читальный зал', visibility: 'public' })
  patch(3, { kind: 'storage', name: 'Книгохранилище', visibility: 'staff' })
  patch(4, { kind: 'technical', name: 'Щитовая', visibility: 'hidden' })
  return { ...doc, spaces }
}

function rectOutline(rooms: number): Pt[] {
  const length = rooms * ROOM_W
  return [
    { x: 0, y: 0 },
    { x: length, y: 0 },
    { x: length, y: DEPTH },
    { x: 0, y: DEPTH },
  ]
}

export function testCampus(): TestCampus {
  const A = 8
  const B = 6
  const V = 5
  const buildings: TestCampusBuilding[] = [
    {
      code: 'А',
      name: 'Учебный корпус',
      outline: rectOutline(A),
      transform: { x: 0, y: 0, rotationDeg: 0 },
      floors: [1, 2, 3].map((level) => ({
        level,
        label: String(level),
        kind: 'regular' as const,
        heightMm: 3300,
        doc: withElevator(floorOf('А', level, A), 'А', level, A),
      })),
    },
    {
      code: 'Б',
      name: 'Лекционный корпус',
      outline: rectOutline(B),
      transform: { x: 70_000, y: 0, rotationDeg: 0 },
      floors: [1, 2, 3, 4, 5].map((level) => ({
        level,
        label: String(level),
        kind: level === 5 ? ('technical' as const) : ('regular' as const),
        heightMm: 3600,
        doc: floorOf('Б', level, B),
      })),
    },
    {
      code: 'В',
      name: 'Библиотека',
      outline: rectOutline(V),
      transform: { x: 0, y: 40_000, rotationDeg: 0 },
      floors: [1, 2].map((level) => ({
        level,
        label: String(level),
        kind: 'regular' as const,
        heightMm: 4000,
        doc: libraryFloor(floorOf('В', level, V), level),
      })),
    },
  ]

  // Входы — в западных торцах коридоров. Аллея вдоль запада связывает А и В, южная дорожка
  // огибает А и ведёт к входу Б; от ворот на юге — к аллее.
  const p = (x: number, y: number): Pt => ({ x, y })
  const site: SitePlanDoc = {
    format: SITE_PLAN_FORMAT,
    boundary: [p(-20_000, -25_000), p(130_000, -25_000), p(130_000, 80_000), p(-20_000, 80_000)],
    features: {
      alley: {
        type: 'path',
        line: [
          p(-6_000, -20_000),
          p(-6_000, -8_000),
          p(-6_000, ENTRANCE_Y),
          p(-6_000, 40_000 + ENTRANCE_Y),
        ],
        widthMm: 3_000,
        covered: false,
        name: 'Главная аллея',
      },
      toA: {
        type: 'path',
        line: [p(-6_000, ENTRANCE_Y), p(-600, ENTRANCE_Y)],
        widthMm: 2_000,
        covered: false,
      },
      toV: {
        type: 'path',
        line: [p(-6_000, 40_000 + ENTRANCE_Y), p(-600, 40_000 + ENTRANCE_Y)],
        widthMm: 2_000,
        covered: false,
      },
      south: {
        type: 'path',
        line: [p(-6_000, -8_000), p(64_000, -8_000), p(64_000, ENTRANCE_Y), p(69_400, ENTRANCE_Y)],
        widthMm: 2_500,
        covered: false,
        name: 'Южная дорожка',
      },
      gate: { type: 'gate', x: -6_000, y: -25_000, widthMm: 6_000, name: 'Главные ворота' },
      parking: {
        type: 'parking',
        polygon: [p(80_000, -22_000), p(125_000, -22_000), p(125_000, -12_000), p(80_000, -12_000)],
        name: 'Парковка',
      },
      lawn: {
        type: 'lawn',
        polygon: [p(5_000, 20_000), p(60_000, 20_000), p(60_000, 36_000), p(5_000, 36_000)],
      },
      sport: {
        type: 'sport',
        polygon: [p(70_000, 25_000), p(110_000, 25_000), p(110_000, 60_000), p(70_000, 60_000)],
        name: 'Стадион',
      },
      ...Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `tree${i + 1}`,
          {
            type: 'tree' as const,
            x: 8_000 + i * 6_500,
            y: 28_000 + (i % 2) * 4_000,
            variant: 'deciduous' as const,
          },
        ]),
      ),
    },
  }
  return { buildings, site }
}
