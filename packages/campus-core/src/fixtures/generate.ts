import type { FloorPlanDoc, PlanSpace, SpaceKind } from '../format/schema.js'
import type { Pt } from '../geom/int.js'
import { buildFaces } from '../topology/faces.js'
import { PlanBuilder } from './edge-cases.js'

/**
 * Генератор тестового кампуса (docs/CAMPUS_BUILDER.md §22.1): реальных планов пилотов нет,
 * поэтому сценарии производительности (§21.1) проверяются на синтетике. Детерминирован по
 * сиду: одинаковые параметры — одинаковый документ, бенчмарки сравнимы между прогонами.
 *
 * Этаж — коридорная система, самая частая у учебных корпусов: коридор во всю длину, по обе
 * стороны аудитории, в торцах лестничные клетки, дверь из каждой комнаты в коридор и вход в
 * торце коридора.
 */
export interface GenerateFloorOptions {
  /** Комнат с каждой стороны коридора (вместе с лестничными клетками в торцах). */
  roomsPerSide: number
  roomWidthMm?: number
  roomDepthMm?: number
  corridorMm?: number
  /** Код корпуса и номер этажа — для номеров помещений «А305». */
  buildingCode?: string
  level?: number
}

export interface GeneratedCampus {
  buildings: {
    id: string
    code: string
    /** Контур корпуса в его системе координат, мм. */
    outline: Pt[]
    /** Положение на территории. */
    transform: { x: number; y: number; rotationDeg: number }
    floors: { level: number; doc: FloorPlanDoc }[]
  }[]
}

const DOOR = {
  type: 'door',
  widthMm: 900,
  heightMm: 2100,
  swing: 'left-in',
  access: 'public',
} as const
const ACADEMIC_CYCLE: SpaceKind[] = [
  'auditorium',
  'auditorium',
  'lab',
  'computer_lab',
  'lecture_hall',
]

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

/** Uuid-образный id помещения вуза для связи с Room: детерминирован, проходит схему. */
function fakeRoomId(code: string, level: number, n: number): string {
  let h = 0
  for (const ch of `${code}:${level}:${n}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0
  const hex = h.toString(16).padStart(8, '0')
  const tail = (n + level * 1000).toString(16).padStart(12, '0').slice(-12)
  return `${hex}-0000-4000-8000-${tail}`
}

export function generateFloor(options: GenerateFloorOptions): FloorPlanDoc {
  const n = Math.max(2, Math.floor(options.roomsPerSide))
  const w = options.roomWidthMm ?? 6000
  const d = options.roomDepthMm ?? 7000
  const c = options.corridorMm ?? 2400
  const code = options.buildingCode ?? 'А'
  const level = options.level ?? 1
  const length = n * w
  const depth = 2 * d + c
  const yLow = d
  const yHigh = d + c

  const b = new PlanBuilder().rect(0, 0, length, depth)
  // Стены коридора во всю длину; перегородки комнат — от наружной стены до коридорной.
  b.wall({ x: 0, y: yLow }, { x: length, y: yLow })
  b.wall({ x: 0, y: yHigh }, { x: length, y: yHigh })
  for (let i = 1; i < n; i++) {
    b.wall({ x: i * w, y: 0 }, { x: i * w, y: yLow })
    b.wall({ x: i * w, y: yHigh }, { x: i * w, y: depth })
  }

  // Двери: из каждой комнаты — в середину её участка коридорной стены; вход — в торце.
  let doorN = 0
  const door = (p: Pt, q: Pt): void => {
    const wallId = b.wallIdAt(p, q)
    const lengthMm = Math.hypot(q.x - p.x, q.y - p.y)
    // Дверь посередине участка — симметрично, от какого конца ни считать смещение.
    b.opening(`o${++doorN}`, {
      ...DOOR,
      wallId,
      offsetMm: Math.round((lengthMm - DOOR.widthMm) / 2),
    })
  }
  for (let i = 0; i < n; i++) {
    door({ x: i * w, y: yLow }, { x: (i + 1) * w, y: yLow })
    door({ x: i * w, y: yHigh }, { x: (i + 1) * w, y: yHigh })
  }
  door({ x: 0, y: yLow }, { x: 0, y: yHigh })

  // Помещения: по одному на грань. Торцы нижнего ряда — лестничные клетки, последняя комната
  // верхнего ряда — санузел, коридор — коридор, остальные — учебные по циклу типов.
  const spaces: Record<string, PlanSpace> = {}
  const verticals: FloorPlanDoc['verticals'] = {}
  const faces = buildFaces(b.doc).faces
  let academic = 0
  for (const face of faces) {
    const xs = face.outer.points.map((p) => p.x)
    const ys = face.outer.points.map((p) => p.y)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    const label = { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }
    const index = Math.round(x0 / w)
    const bottom = y1 <= yLow
    const corridor = y0 === yLow && y1 === yHigh
    let kind: SpaceKind
    if (corridor) kind = 'corridor'
    else if (bottom && (index === 0 || index === n - 1)) kind = 'stairwell'
    else if (!bottom && index === n - 1) kind = 'restroom'
    else kind = ACADEMIC_CYCLE[academic++ % ACADEMIC_CYCLE.length]!
    const number = `${code}${level}${String(index + 1 + (bottom ? 0 : n)).padStart(2, '0')}`
    const space: PlanSpace = {
      label,
      edges: [...face.wallIds],
      kind,
      visibility: 'public',
      ...(corridor ? { name: 'Коридор' } : { number }),
      ...(kind === 'auditorium' ||
      kind === 'lab' ||
      kind === 'computer_lab' ||
      kind === 'lecture_hall'
        ? { roomId: fakeRoomId(code, level, index + (bottom ? 0 : n)), capacity: 30 }
        : {}),
    }
    spaces[corridor ? 's_corridor' : `s_${number}`] = space
    if (kind === 'stairwell') {
      const inset = 500
      verticals[`v_${index === 0 ? 'L' : 'R'}`] = {
        type: 'stairs',
        groupId: `${code}-stairs-${index === 0 ? 'L' : 'R'}`,
        outline: [
          [x0 + inset, y0 + inset],
          [x1 - inset, y0 + inset],
          [x1 - inset, y1 - inset],
          [x0 + inset, y1 - inset],
        ],
        stepFree: false,
        landing: { x: label.x, y: y1 - inset - 500 },
      }
    }
  }
  return { ...b.doc, spaces, verticals }
}

/**
 * Кампус из N корпусов по M этажей — для сценариев §21.1 («20 корпусов × 10 этажей»).
 * Число комнат на корпус колеблется вокруг `roomsPerSide`; корпуса стоят рядами на
 * территории с проездами между ними.
 */
export function generateCampus(options: {
  buildings: number
  floors: number
  roomsPerSide: number
  seed?: number
}): GeneratedCampus {
  const rand = rng(options.seed ?? 1)
  const codes = 'АБВГДЕЖЗИКЛМНОПРСТУФ'
  const perRow = Math.ceil(Math.sqrt(options.buildings))
  const buildings: GeneratedCampus['buildings'] = []
  for (let i = 0; i < options.buildings; i++) {
    const code =
      codes[i % codes.length]! + (i >= codes.length ? String(Math.floor(i / codes.length)) : '')
    const rooms = Math.max(3, Math.round(options.roomsPerSide * (0.7 + rand() * 0.6)))
    const length = rooms * 6000
    const depth = 2 * 7000 + 2400
    const floors = Array.from({ length: options.floors }, (_, f) => ({
      level: f + 1,
      doc: generateFloor({ roomsPerSide: rooms, buildingCode: code, level: f + 1 }),
    }))
    buildings.push({
      id: `b${i + 1}`,
      code,
      outline: [
        { x: 0, y: 0 },
        { x: length, y: 0 },
        { x: length, y: depth },
        { x: 0, y: depth },
      ],
      transform: { x: (i % perRow) * 160_000, y: Math.floor(i / perRow) * 60_000, rotationDeg: 0 },
      floors,
    })
  }
  return { buildings }
}
