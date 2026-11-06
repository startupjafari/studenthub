import type { SpaceKind } from '@studenthub/campus-core'

/**
 * Палитра карты в духе 2ГИС: кабинеты голубые, коридоры почти белые, еда персиковая,
 * службы серые, корпус без этого этажа — приглушённо-лососевый. Светлая и тёмная версии
 * одной схемы: карта следует теме приложения.
 */
export interface MapPalette {
  ground: string
  lawn: string
  tree: string
  treeEdge: string
  road: string
  path: string
  pathEdge: string
  parking: string
  sport: string
  rest: string
  boundary: string
  slab: string
  room: string
  circulation: string
  food: string
  service: string
  separator: string
  innerWall: string
  outerWall: string
  absent: string
  absentEdge: string
  text: string
  muted: string
  halo: string
  badge: string
  entrance: string
  primary: string
  /** Маршрут: тёмная кайма под линией и булавки начала и конца. */
  routeCasing: string
  routeStart: string
  routeEnd: string
}

const LIGHT: MapPalette = {
  ground: '#f5f1ea',
  lawn: '#d4ecc6',
  tree: '#a6d78f',
  treeEdge: '#86c06d',
  road: '#d8dbe1',
  path: '#ffffff',
  pathEdge: '#e2dccf',
  parking: '#e8e5df',
  sport: '#f5ddc3',
  rest: '#e4f1d0',
  boundary: '#c8bea9',
  slab: '#ffffff',
  room: '#c6dcf7',
  circulation: '#f0f6fd',
  food: '#ffd8bd',
  service: '#e3e7ee',
  separator: '#ffffff',
  innerWall: '#b7cdea',
  outerWall: '#7f9fca',
  absent: '#f2a597',
  absentEdge: '#dd7f70',
  text: '#26313f',
  muted: '#6b7685',
  halo: '#ffffff',
  badge: '#2f80ed',
  entrance: '#16a34a',
  primary: '#2563eb',
  routeCasing: '#1e3a8a',
  routeStart: '#16a34a',
  routeEnd: '#dc2626',
}

const DARK: MapPalette = {
  ground: '#141920',
  lawn: '#1c3224',
  tree: '#2c5637',
  treeEdge: '#3b6e47',
  road: '#2a2f38',
  path: '#363c47',
  pathEdge: '#2b3039',
  parking: '#22272f',
  sport: '#382d22',
  rest: '#233020',
  boundary: '#3c4350',
  slab: '#1a2130',
  room: '#253f68',
  circulation: '#1e293a',
  food: '#5a3a25',
  service: '#2b323e',
  separator: '#10141b',
  innerWall: '#33507a',
  outerWall: '#5a7cab',
  absent: '#6b3a33',
  absentEdge: '#8a4b41',
  text: '#e6edf7',
  muted: '#9aa6b6',
  halo: '#0f1319',
  badge: '#3b82f6',
  entrance: '#22c55e',
  primary: '#3b82f6',
  routeCasing: '#1e3a8a',
  routeStart: '#22c55e',
  routeEnd: '#ef4444',
}

export function mapPalette(dark: boolean): MapPalette {
  return dark ? DARK : LIGHT
}

const CIRCULATION: readonly SpaceKind[] = ['corridor', 'hall', 'elevator_hall', 'stairwell']
const FOOD: readonly SpaceKind[] = ['canteen']
const SERVICE: readonly SpaceKind[] = ['restroom', 'storage', 'technical']

export function spaceFill(kind: SpaceKind, p: MapPalette): string {
  if (CIRCULATION.includes(kind)) return p.circulation
  if (FOOD.includes(kind)) return p.food
  if (SERVICE.includes(kind)) return p.service
  return p.room
}

/** Коридоры и лестничные клетки не выбираются кликом: это проходы, а не места. */
export function isPickable(kind: SpaceKind): boolean {
  return !CIRCULATION.includes(kind) || kind === 'hall'
}

export function isCirculation(kind: SpaceKind): boolean {
  return CIRCULATION.includes(kind)
}
