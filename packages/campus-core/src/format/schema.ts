import { z } from 'zod'

/**
 * Формат документа этажа (docs/CAMPUS_BUILDER.md §10.4). Все координаты и размеры — целые
 * миллиметры в системе корпуса: на целых числах предикаты пересечения и ориентации точны,
 * без эпсилонов (§11.2). Пределы координат ±10 км держат векторные произведения в пределах
 * точных целых double (2^53).
 *
 * Объекты хранятся словарями по id, а не массивами: точечная правка не переписывает соседей,
 * и порядок обхода ни на что не влияет.
 */
export const FLOOR_PLAN_FORMAT = 1

/** Предел координаты по модулю, мм (10 км). */
export const COORD_LIMIT_MM = 10_000_000

/** Потолки размера документа — защита сервера от дорогой валидации (§19.3). */
export const FLOOR_PLAN_LIMITS = {
  nodes: 20_000,
  walls: 30_000,
  openings: 5_000,
  spaces: 3_000,
  verticals: 200,
  labels: 1_000,
  spaceEdges: 500,
  outlinePoints: 64,
} as const

/** Назначения помещений. Тип — что это, а не где: геометрию задаёт грань графа стен. */
export const SPACE_KINDS = [
  'auditorium',
  'lecture_hall',
  'lab',
  'computer_lab',
  'sport_hall',
  'office',
  'dean_office',
  'library',
  'canteen',
  'restroom',
  'hall',
  'corridor',
  'stairwell',
  'elevator_hall',
  'storage',
  'technical',
  'other',
] as const
export type SpaceKind = (typeof SPACE_KINDS)[number]

/**
 * Учебные помещения: у них обязательна связь с `Room` StudentHub — по ним идёт расписание
 * (решение владельца, §27.1). Без связи публикация блокируется.
 */
export const ACADEMIC_SPACE_KINDS: readonly SpaceKind[] = [
  'auditorium',
  'lecture_hall',
  'lab',
  'computer_lab',
  'sport_hall',
]

/** Типы, которые по умолчанию не показываются зрителям (§19.2). */
export const HIDDEN_BY_DEFAULT_KINDS: readonly SpaceKind[] = ['technical', 'storage']

const Id = z.string().min(1).max(40)
const Mm = z.number().int().min(-COORD_LIMIT_MM).max(COORD_LIMIT_MM)
const Point = z.object({ x: Mm, y: Mm }).strict()

export const PlanNodeSchema = Point

export const WALL_KINDS = ['wall', 'glass', 'virtual'] as const

/**
 * Стена — ребро планарного графа между узлами `a` и `b`. `virtual` — граница без геометрии:
 * делит открытое пространство на зоны (холл и коридор), в 3D её нет.
 */
export const PlanWallSchema = z
  .object({
    a: Id,
    b: Id,
    thicknessMm: z.number().int().min(20).max(2_000),
    kind: z.enum(WALL_KINDS),
    // Высота отдельно от этажа — для низких перегородок; нет — высота этажа.
    heightMm: z.number().int().min(100).max(20_000).optional(),
  })
  .strict()

const OpeningBase = {
  // null — проём «припаркован»: его стену удалили, атрибуты ждут новой стены (§12.6).
  wallId: Id.nullable(),
  // Расстояние от узла `a` стены до начала проёма вдоль её оси.
  offsetMm: z
    .number()
    .int()
    .min(0)
    .max(2 * COORD_LIMIT_MM),
  widthMm: z.number().int().min(300).max(20_000),
  heightMm: z.number().int().min(300).max(10_000),
}

export const DOOR_SWINGS = [
  'left-in',
  'left-out',
  'right-in',
  'right-out',
  'sliding',
  'none',
] as const
export const DOOR_ACCESS = ['public', 'staff', 'closed'] as const

export const PlanOpeningSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('door'),
      ...OpeningBase,
      swing: z.enum(DOOR_SWINGS),
      access: z.enum(DOOR_ACCESS),
    })
    .strict(),
  z
    .object({
      type: z.literal('window'),
      ...OpeningBase,
      sillMm: z.number().int().min(0).max(10_000),
    })
    .strict(),
])

export const SPACE_VISIBILITY = ['public', 'staff', 'hidden'] as const

/**
 * Помещение — назначение грани графа стен. Геометрию (контур, площадь) не хранит: она
 * пересчитывается из стен. `edges` и `label` — якоря идентичности: по ним помещение находит
 * свою грань после правки стен (§11.5).
 */
export const PlanSpaceSchema = z
  .object({
    label: Point,
    edges: z.array(Id).max(FLOOR_PLAN_LIMITS.spaceEdges),
    number: z.string().trim().max(20).optional(),
    name: z.string().trim().max(100).optional(),
    kind: z.enum(SPACE_KINDS),
    capacity: z.number().int().min(0).max(10_000).optional(),
    visibility: z.enum(SPACE_VISIBILITY),
    roomId: z.string().uuid().optional(),
  })
  .strict()

export const VERTICAL_TYPES = ['stairs', 'elevator', 'ramp'] as const

/**
 * Лестница, лифт или пандус на этаже. Этажи связывает общий `groupId`: одна лестница на всех
 * уровнях — один `groupId`, ссылок «из этажа в этаж» нет.
 */
export const PlanVerticalSchema = z
  .object({
    type: z.enum(VERTICAL_TYPES),
    groupId: Id,
    outline: z
      .array(z.tuple([Mm, Mm]))
      .min(3)
      .max(FLOOR_PLAN_LIMITS.outlinePoints),
    stepFree: z.boolean(),
    landing: Point,
  })
  .strict()

export const PlanLabelSchema = z
  .object({ x: Mm, y: Mm, text: z.string().trim().min(1).max(200) })
  .strict()

function capped<T extends z.ZodTypeAny>(item: T, max: number, what: string) {
  return z
    .record(Id, item)
    .refine((r) => Object.keys(r).length <= max, { message: `Слишком много: ${what}` })
}

export const FloorPlanSchema = z
  .object({
    format: z.literal(FLOOR_PLAN_FORMAT),
    nodes: capped(PlanNodeSchema, FLOOR_PLAN_LIMITS.nodes, 'узлы'),
    walls: capped(PlanWallSchema, FLOOR_PLAN_LIMITS.walls, 'стены'),
    openings: capped(PlanOpeningSchema, FLOOR_PLAN_LIMITS.openings, 'проёмы'),
    spaces: capped(PlanSpaceSchema, FLOOR_PLAN_LIMITS.spaces, 'помещения'),
    verticals: capped(PlanVerticalSchema, FLOOR_PLAN_LIMITS.verticals, 'лестницы и лифты'),
    labels: capped(PlanLabelSchema, FLOOR_PLAN_LIMITS.labels, 'метки'),
  })
  .strict()

export type PlanPoint = z.infer<typeof Point>
export type PlanNode = z.infer<typeof PlanNodeSchema>
export type PlanWall = z.infer<typeof PlanWallSchema>
export type PlanOpening = z.infer<typeof PlanOpeningSchema>
export type PlanSpace = z.infer<typeof PlanSpaceSchema>
export type PlanVertical = z.infer<typeof PlanVerticalSchema>
export type PlanLabel = z.infer<typeof PlanLabelSchema>
export type FloorPlanDoc = z.infer<typeof FloorPlanSchema>

/** Пустой этаж текущего формата. */
export function emptyFloorPlan(): FloorPlanDoc {
  return {
    format: FLOOR_PLAN_FORMAT,
    nodes: {},
    walls: {},
    openings: {},
    spaces: {},
    verticals: {},
    labels: {},
  }
}
