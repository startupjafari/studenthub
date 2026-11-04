import type { SpaceKind } from '@studenthub/campus-core'

/**
 * Цвет назначения помещения — одинаковый в редакторе, 2D-просмотре и 3D (§13.3). Цвета
 * насыщенные: заливка рисуется с прозрачностью и читается на светлой и тёмной теме.
 * Группы, а не цвет на каждый тип: глаз различает пять-шесть оттенков, не семнадцать.
 */
const GROUPS = {
  study: '#3b82f6',
  office: '#8b5cf6',
  food: '#f59e0b',
  care: '#14b8a6',
  books: '#22c55e',
  move: '#94a3b8',
  back: '#78716c',
} as const

export const SPACE_KIND_COLOR: Record<SpaceKind, string> = {
  auditorium: GROUPS.study,
  lecture_hall: GROUPS.study,
  lab: GROUPS.study,
  computer_lab: GROUPS.study,
  sport_hall: GROUPS.study,
  office: GROUPS.office,
  dean_office: GROUPS.office,
  library: GROUPS.books,
  canteen: GROUPS.food,
  restroom: GROUPS.care,
  hall: GROUPS.move,
  corridor: GROUPS.move,
  stairwell: GROUPS.move,
  elevator_hall: GROUPS.move,
  storage: GROUPS.back,
  technical: GROUPS.back,
  other: GROUPS.move,
}
