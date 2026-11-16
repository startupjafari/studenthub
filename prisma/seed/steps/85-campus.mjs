// Шаг «кампус»: карта вуза из Campus 3D Builder — корпуса, этажи, территория и опубликованная
// версия (docs/CAMPUS_BUILDER.md). Данные повторяют путь админа в редакторе, а не «что-нибудь
// похожее»:
//   1) «Создать корпус» — прямоугольный контур, этажи с наружными стенами по контуру;
//   2) «Автопланировка» — коридор, кабинеты по обе стороны, лестницы и туалеты в торцах,
//      лифтовой холл, двери, окна, вход на 1 этаже (сохранение плана: ревизия 0 → 1, снимок
//      «autosave» с голым каркасом);
//   3) расстановка аудиторий вуза по ячейкам и «Связать по номерам» (ревизия 1 → 2);
//   4) территория: аллея, дорожки к входам, ворота, парковка, газоны, деревья;
//   5) «Опубликовать» — версия №1: манифест, этажи, индекс помещений и граф маршрутов.
//
// Геометрию и всё производное считает тот же пакет, что редактор и сервер публикации
// (@studenthub/campus-core): автопланировка, проверка этажа, индекс помещений, граф маршрутов.
// Руками здесь только раскладка аудиторий по ячейкам и территория.
//
// Каждая аудитория вуза (Room) стоит на карте в своём корпусе и на своём этаже — по полям
// Room.building и Room.floor: наклейка «Корпус Б, 3 этаж» и карта не расходятся. Поэтому
// корпусов столько, сколько разных корпусов у аудиторий вуза (у генератора — до трёх).
//
// Связь помещения с Room в документе этажа — только uuid (PlanSpaceSchema.roomId). Если id
// аудиторий не uuid (старый формат генератора `u042-room-7`), документ остаётся без связи,
// а связь пишется только в индекс версии: мост «где аудитория» из расписания работает, но
// проверка в редакторе покажет ROOM_REQUIRED, и переопубликовать карту без перевязки нельзя.

import { createHash } from 'node:crypto'

import { id, seedUuid } from '../lib/ids.mjs'

// Пакет собран в dist (pnpm --filter @studenthub/campus-core build; workflow Seed собирает
// packages/* до сида). Корень репозитория от пакета не зависит, поэтому путь — относительный.
const CORE_URL = new URL('../../../packages/campus-core/dist/index.js', import.meta.url)
let corePromise = null

function loadCore() {
  corePromise ??= import(CORE_URL.href).catch((error) => {
    corePromise = null
    error.message =
      `Кампус: не загрузился @studenthub/campus-core (${CORE_URL.pathname}). ` +
      `Соберите пакет: pnpm --filter @studenthub/campus-core build. ${error.message}`
    throw error
  })
  return corePromise
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Id объектов в документе этажа — как у редактора (randomIds: префикс + 10 знаков base36),
// но от хеша, а не от случайности: повторный прогон даёт тот же документ.
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function hashedIds(key) {
  const counters = {}
  return (kind) => {
    counters[kind] = (counters[kind] ?? 0) + 1
    const digest = createHash('sha256').update(`${key}:${kind}:${counters[kind]}`).digest()
    let body = ''
    for (let i = 0; i < 10; i += 1) body += ID_ALPHABET[digest[i] % ID_ALPHABET.length]
    return `${kind}_${body}`
  }
}

// Id объектов территории — как у редактора территории (`f_` + 10 hex).
function featureId(key, n) {
  return `f_${createHash('sha256').update(`${key}:f:${n}`).digest('hex').slice(0, 10)}`
}

// ── Помещения ─────────────────────────────────────────────────────────────────────

// Room.kind → назначение на карте и сколько ячеек автопланировки (кабинетов по 6 м) занимает
// помещение: столовая и библиотека — две, спортзал — три (перегородки между ними снимаются).
const SPACE_BY_ROOM_KIND = {
  AUDITORIUM: { kind: 'auditorium', cells: 1 },
  LAB: { kind: 'lab', cells: 1 },
  SPORT_HALL: { kind: 'sport_hall', cells: 3 },
  LIBRARY: { kind: 'library', cells: 2 },
  ASSEMBLY_HALL: { kind: 'other', cells: 2 },
  ADMIN_OFFICE: { kind: 'office', cells: 1 },
  DEAN_OFFICE: { kind: 'dean_office', cells: 1 },
  ACCOUNTING: { kind: 'office', cells: 1 },
  CANTEEN: { kind: 'canteen', cells: 2 },
  OTHER: { kind: 'other', cells: 1 },
}

// Общежитие — отдельное здание вне учебного кампуса: в учебном корпусе ему не место, а
// пустой корпус ради одной записи только запутал бы карту.
const OFF_CAMPUS = new Set(['DORMITORY'])

// Большая аудитория на карте — поточная, на две ячейки.
const LECTURE_HALL_CAPACITY = 80

// Ячейки, которым не досталось аудитории: обычная жизнь корпуса. Хранилища и техника скрыты
// по умолчанию, как их ставит редактор (HIDDEN_BY_DEFAULT_KINDS).
const FILLERS = [
  [{ kind: 'office', name: 'Кафедра' }, 30],
  [{ kind: 'office', name: 'Преподавательская', visibility: 'staff' }, 12],
  [{ kind: 'office', name: 'Методический кабинет' }, 8],
  [{ kind: 'office' }, 14],
  [{ kind: 'storage', name: 'Архив', visibility: 'hidden' }, 8],
]
// Эти — по одному на кампус: первые свободные ячейки, пока не кончатся.
const UNIQUE_FILLERS = [
  { kind: 'other', name: 'Медпункт' },
  { kind: 'office', name: 'Студенческий совет' },
  { kind: 'office', name: 'Центр карьеры' },
  { kind: 'technical', name: 'Серверная', visibility: 'hidden' },
]

/** Номер на двери из названия аудитории: «104» → 104, «Лаборатория 106» → 106. */
function splitRoomName(name) {
  const match = /\d+[a-zа-я]?/i.exec(name)
  if (!match) return { number: undefined, name }
  const rest = name.replace(match[0], '').replace(/\s+/g, ' ').trim()
  return { number: match[0].slice(0, 20), name: rest || undefined }
}

function roomItem(room) {
  const base = SPACE_BY_ROOM_KIND[room.kind] ?? SPACE_BY_ROOM_KIND.OTHER
  const big = room.kind === 'AUDITORIUM' && (room.capacity ?? 0) >= LECTURE_HALL_CAPACITY
  const kind = big ? 'lecture_hall' : base.kind
  // Номер с двери — только у учебных: у библиотеки и столовой номер даёт этаж.
  const academic = room.kind === 'AUDITORIUM' || room.kind === 'LAB'
  const parts = academic ? splitRoomName(room.name) : { number: undefined, name: room.name }
  return {
    room,
    kind,
    cells: big ? 2 : base.cells,
    number: parts.number,
    name: parts.name?.slice(0, 100),
    capacity: room.capacity ?? undefined,
  }
}

// ── Этаж ──────────────────────────────────────────────────────────────────────────

const STEP_MM = 6000
const MIN_LENGTH_MM = 36_000
const MAX_LENGTH_MM = 240_000
// Свободных кабинетов на этаже сверх аудиторий: кафедры, архив, преподавательская.
const SPARE_CELLS = 2

function sharedWalls(a, b) {
  return a.edges.filter((e) => b.edges.includes(e))
}

/**
 * Этаж корпуса: автопланировка по контуру и раскладка помещений по её ячейкам. null — ячеек
 * не хватило (корпус надо удлинить).
 */
function layoutFloor(core, building, floor, items, random) {
  const result = core.autoLayout(building.outline, { level: floor.level, lifts: building.lifts })
  if ('error' in result) {
    throw new Error(
      `Кампус: автопланировка «${building.name}», этаж ${floor.level}: ${result.error}`,
    )
  }
  const ids = hashedIds(floor.id)
  // Те же объекты с детерминированными id: копия этажа переадресует все ссылки внутри.
  let doc = core.cloneFloorPlan(result.doc, ids)
  // Лестница продолжается по этажам одного корпуса общим groupId. Автопланировка строит его
  // из координат ячейки, и у двух корпусов с лестницей в одном углу он совпал бы — граф
  // маршрутов связал бы этажи разных корпусов.
  const verticals = {}
  for (const [vid, v] of Object.entries(doc.verticals)) {
    verticals[vid] = { ...v, groupId: `${building.groupPrefix}-${v.groupId}`.slice(0, 40) }
  }
  doc = { ...doc, verticals }

  // Кабинеты автопланировки — помещения с номером, по порядку номеров (вдоль коридора).
  const cells = Object.entries(doc.spaces)
    .filter(([, s]) => s.number !== undefined)
    .sort((a, b) => Number(a[1].number) - Number(b[1].number))
    .map(([spaceId, s]) => ({ id: spaceId, edges: s.edges, label: s.label, free: true }))

  // Большие помещения — подряд идущие соседние кабинеты одного ряда.
  const merges = []
  for (const item of items.filter((i) => i.cells > 1)) {
    let placed = null
    for (let i = 0; i + item.cells <= cells.length && !placed; i += 1) {
      const run = cells.slice(i, i + item.cells)
      if (!run.every((c) => c.free)) continue
      const walls = []
      for (let j = 1; j < run.length; j += 1) walls.push(...sharedWalls(run[j - 1], run[j]))
      if (walls.length < run.length - 1) continue
      placed = { item, run, walls }
    }
    if (!placed) return null
    for (const c of placed.run) c.free = false
    merges.push(placed)
  }
  const singles = items.filter((i) => i.cells === 1)
  const free = cells.filter((c) => c.free)
  if (free.length < singles.length) return null

  // Слияние: перегородки между кабинетами снимаются, помещение остаётся у первого кабинета,
  // метка — посередине; грань ему подбирает matchSpaces, как после правки в редакторе.
  const spaces = { ...doc.spaces }
  for (const { run, walls } of merges) {
    for (const wall of walls) doc = core.removeWall(doc, wall, ids).doc
    const first = run[0]
    const last = run[run.length - 1]
    for (const c of run.slice(1)) delete spaces[c.id]
    spaces[first.id] = {
      ...spaces[first.id],
      label: {
        x: Math.round((first.label.x + last.label.x) / 2),
        y: Math.round((first.label.y + last.label.y) / 2),
      },
    }
  }
  const matched = core.matchSpaces({ ...doc, spaces })
  if (matched.lost.length > 0) {
    throw new Error(`Кампус: «${building.name}», этаж ${floor.level}: потеряны помещения`)
  }
  doc = matched.doc

  // Номера неучебных помещений — после номеров аудиторий этажа, чтобы поиск «105» не находил
  // две двери.
  const taken = new Set(items.map((i) => i.number).filter(Boolean))
  let next = floor.level * 100 + 10
  const nextNumber = () => {
    while (taken.has(String(next))) next += 1
    taken.add(String(next))
    return String(next++)
  }

  const assign = (spaceId, attrs) => {
    const { label, edges } = doc.spaces[spaceId]
    const space = { label, edges, kind: attrs.kind, visibility: attrs.visibility ?? 'public' }
    space.number = attrs.number ?? nextNumber()
    if (attrs.name) space.name = attrs.name
    if (attrs.capacity !== undefined) space.capacity = attrs.capacity
    if (attrs.roomId) space.roomId = attrs.roomId
    if (space.visibility === 'public' && (attrs.kind === 'storage' || attrs.kind === 'technical')) {
      space.visibility = 'hidden'
    }
    doc.spaces[spaceId] = space
  }
  doc = { ...doc, spaces: { ...doc.spaces } }
  const links = {}
  const place = (spaceId, item) => {
    const linkable = item.room && UUID.test(item.room.id)
    assign(spaceId, { ...item, roomId: linkable ? item.room.id : undefined })
    if (item.room) links[spaceId] = item.room.id
  }
  for (const { item, run } of merges) place(run[0].id, item)
  for (const [i, item] of singles.entries()) place(free[i].id, item)
  for (const cell of free.slice(singles.length)) {
    const unique = UNIQUE_FILLERS.find((f) => !building.usedFillers.has(f.name))
    if (unique) building.usedFillers.add(unique.name)
    assign(cell.id, unique ?? random.pickWeighted(FILLERS))
  }

  // Подпись «Главный вход» у двери с улицы — так её ставит автор поверх автопланировки.
  const entrance = floor.level === 1 ? findEntrance(core, doc, building.outline) : null
  if (entrance) {
    doc = {
      ...doc,
      labels: {
        [ids('t')]: {
          x: Math.round(entrance.door.x - entrance.normal.x * 1500),
          y: Math.round(entrance.door.y - entrance.normal.y * 1500),
          text: 'Главный вход',
        },
      },
    }
  }
  return { doc, links, entrance }
}

/** Дверь в наружной стене и нормаль наружу — в координатах корпуса. */
function findEntrance(core, doc, outline) {
  for (const o of Object.values(doc.openings)) {
    if (o.type !== 'door' || !o.wallId) continue
    const w = doc.walls[o.wallId]
    if (w.thicknessMm !== core.OUTER_WALL.thicknessMm) continue
    const a = doc.nodes[w.a]
    const b = doc.nodes[w.b]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const along = o.offsetMm + o.widthMm / 2
    const door = { x: a.x + ux * along, y: a.y + uy * along }
    // Левая нормаль; снаружи она или внутри — по контуру корпуса.
    let normal = { x: -uy, y: ux }
    const probe = { x: door.x + normal.x * 1000, y: door.y + normal.y * 1000 }
    if (core.pointInPolygon(probe, outline) === 'inside') normal = { x: uy, y: -ux }
    return { door, normal }
  }
  return null
}

/**
 * Корпус целиком: длина подбирается шагом кабинета, пока на каждом этаже не поместятся все
 * его помещения (у этажей одного корпуса одна сетка — контур общий).
 */
function layoutBuilding(core, building, itemsByLevel, random) {
  const need = Math.max(
    ...building.floors.map((f) => {
      const items = itemsByLevel.get(f.level) ?? []
      return items.reduce((sum, i) => sum + i.cells, 0) + SPARE_CELLS
    }),
  )
  // Ряд у торцов теряет лестницу и туалет, у середины — лифтовой холл: ~5 ячеек на этаж.
  let length = Math.max(MIN_LENGTH_MM, Math.ceil((need + 6) / 2) * STEP_MM)
  for (; length <= MAX_LENGTH_MM; length += STEP_MM) {
    building.outline = core.normalizeOutline(
      core.outlineFromShape('rect', length, building.depthMm, building.depthMm),
    )
    // Неудачная попытка не должна «израсходовать» единичные кабинеты кампуса.
    const usedBefore = new Set(building.usedFillers)
    const floors = []
    for (const floor of building.floors) {
      const laid = layoutFloor(core, building, floor, itemsByLevel.get(floor.level) ?? [], random)
      if (!laid) break
      floors.push({ ...floor, ...laid })
    }
    if (floors.length === building.floors.length) {
      building.floors = floors
      building.lengthMm = length
      return building
    }
    building.usedFillers.clear()
    for (const name of usedBefore) building.usedFillers.add(name)
  }
  throw new Error(
    `Кампус: «${building.name}» не вмещает свои аудитории даже при ${MAX_LENGTH_MM} мм`,
  )
}

// ── Территория ────────────────────────────────────────────────────────────────────

/**
 * Территория: корпуса стоят в ряд вдоль аллеи, к каждому входу — дорожка от аллеи, к аллее —
 * дорожка от ворот на улицу. Дорожки и улица — пешеходная сеть графа маршрутов: без них
 * переход между корпусами шёл бы напрямую через двор.
 */
function buildSite(core, buildings, key, random) {
  const features = {}
  let n = 0
  const add = (feature) => {
    features[featureId(key, (n += 1))] = feature
  }
  const rings = buildings.map((b) => b.outline.map((p) => core.toCampus(p, b.transform)))
  const xs = rings.flat().map((p) => p.x)
  const ys = rings.flat().map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const alleyY = minY - 14_000
  const fenceS = alleyY - 26_000
  const fenceW = minX - 20_000
  const fenceE = maxX + 20_000
  const sportY0 = maxY + 12_000
  const sportY1 = sportY0 + 40_000
  const fenceN = sportY1 + 10_000
  const gateX = Math.round((minX + maxX) / 2 / 1000) * 1000

  // Дорожки к входам: от двери наружу и вниз до аллеи. Точки примыкания — вершины аллеи:
  // граф сводит дорожки только в общих вершинах (ближе 2 м), не в середине отрезка.
  const junctions = new Set([gateX])
  for (const b of buildings) {
    const e = b.floors.find((f) => f.level === 1)?.entrance
    if (!e) continue
    const door = core.toCampus(e.door, b.transform)
    const r = (b.transform.rotationDeg * Math.PI) / 180
    const normal = {
      x: e.normal.x * Math.cos(r) - e.normal.y * Math.sin(r),
      y: e.normal.x * Math.sin(r) + e.normal.y * Math.cos(r),
    }
    const at = (d) => ({
      x: Math.round(door.x + normal.x * d),
      y: Math.round(door.y + normal.y * d),
    })
    const line = [at(1500), at(4000)]
    const last = line[1]
    // Вход с севера — в обход корпуса с запада, иначе дорожка прошла бы сквозь него.
    if (normal.y > 0.5) line.push({ x: Math.min(...rings[b.sortOrder].map((p) => p.x)) - 4000, y: last.y }) // prettier-ignore
    const x = line[line.length - 1].x
    line.push({ x, y: alleyY })
    junctions.add(x)
    add({ type: 'path', line, widthMm: 2000, covered: false, name: `Ко входу: ${b.name}`.slice(0, 100) }) // prettier-ignore
  }
  const alleyXs = [...junctions, fenceW + 1500, fenceE - 1500].sort((a, b) => a - b)
  add({
    type: 'path',
    line: alleyXs.map((x) => ({ x, y: alleyY })),
    widthMm: 4000,
    covered: false,
    name: 'Центральная аллея',
  })
  add({
    type: 'path',
    line: [
      { x: gateX, y: fenceS + 500 },
      { x: gateX, y: alleyY },
    ],
    widthMm: 4000,
    covered: false,
  })
  add({
    type: 'road',
    line: [
      { x: fenceW - 20_000, y: fenceS - 8000 },
      { x: fenceE + 20_000, y: fenceS - 8000 },
    ],
    widthMm: 12_000,
    name: random.pick(['ул. Университетская', 'пр. Абая', 'ул. Студенческая', 'пр. Независимости']),
  })
  add({ type: 'gate', x: gateX, y: fenceS, widthMm: 6000, name: 'Главные ворота' })
  add({ type: 'gate', x: fenceE, y: alleyY, widthMm: 4000, name: 'Хозяйственный въезд' })

  const rect = (x0, y0, x1, y1) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  // Между аллеей и забором: слева газон, справа парковка; проход от ворот — между ними.
  add({ type: 'lawn', polygon: rect(fenceW + 3000, fenceS + 3000, gateX - 5000, alleyY - 4000) })
  add({
    type: 'parking',
    polygon: rect(gateX + 5000, fenceS + 3000, fenceE - 3000, alleyY - 4000),
    name: 'Парковка',
  })
  // За корпусами: газон, стадион и сквер — сколько поместится по ширине территории.
  add({ type: 'lawn', polygon: rect(minX, maxY + 4000, maxX, sportY0 - 4000) })
  const sportX0 = fenceW + 5000
  add({ type: 'sport', polygon: rect(sportX0, sportY0, sportX0 + 60_000, sportY1), name: 'Стадион' }) // prettier-ignore
  const restX0 = sportX0 + 66_000
  const restX1 = Math.min(restX0 + 30_000, fenceE - 5000)
  if (restX1 - restX0 >= 10_000) {
    add({ type: 'rest', polygon: rect(restX0, sportY0, restX1, sportY0 + 24_000), name: 'Сквер' })
    for (let i = 0; i < 8; i += 1) {
      add({
        type: 'tree',
        x: random.randInt(restX0 + 2000, restX1 - 2000),
        y: random.randInt(sportY0 + 2000, sportY0 + 22_000),
        variant: random.chance(0.5) ? 'deciduous' : 'conifer',
      })
    }
  }

  // Деревья вдоль аллеи, мимо примыканий дорожек.
  for (let x = fenceW + 6000; x < fenceE - 6000; x += 9000) {
    if ([...junctions].some((j) => Math.abs(j - x) < 4000)) continue
    add({
      type: 'tree',
      x,
      y: alleyY + 3500,
      variant: random.chance(0.7) ? 'deciduous' : 'conifer',
    })
  }
  add({ type: 'label', x: gateX, y: alleyY + 7000, text: 'Учебный двор' })

  return core.SitePlanSchema.parse({
    format: core.SITE_PLAN_FORMAT,
    boundary: rect(fenceW, fenceS, fenceE, fenceN),
    features,
  })
}

// ── Шаг ───────────────────────────────────────────────────────────────────────────

export async function seedCampus(prisma, writer, ctx) {
  const { index, random, structure, people } = ctx
  const { uniId, profile, faculties } = structure
  const authorId = people.adminId
  const campusId = seedUuid(id(index, 'campus', 1))
  // Повторный прогон: кампус уже есть — граф и индекс не пересчитываем.
  if (await prisma.campus.findUnique({ where: { id: campusId }, select: { id: true } })) return

  const core = await loadCore()
  // Аудитории — из базы, а не из structure.rooms: нужны название, тип, корпус и этаж.
  await writer.flush()
  const all = await prisma.room.findMany({
    where: { universityId: uniId },
    select: { id: true, name: true, kind: true, capacity: true, building: true, floor: true },
    orderBy: [{ building: 'asc' }, { floor: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    take: 5000,
  })
  const rooms = all.filter((r) => !OFF_CAMPUS.has(r.kind))
  const linkable = rooms.every((r) => UUID.test(r.id))

  // Корпуса — по корпусам аудиторий; аудитория без корпуса — в первом.
  const names = [...new Set(rooms.map((r) => r.building?.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  )
  if (names.length === 0) names.push('Корпус А')
  const byBuilding = new Map(names.map((name) => [name, new Map()]))
  const push = (name, level, item) => {
    const levels = byBuilding.get(name)
    levels.set(level, [...(levels.get(level) ?? []), item])
  }
  for (const room of rooms) {
    const name = room.building?.trim() || names[0]
    push(name, Math.min(9, Math.max(1, room.floor ?? 1)), roomItem(room))
  }

  // Медпункт, студсовет и прочие единичные кабинеты — общие на весь кампус.
  const usedFillers = new Set()
  const buildings = names.map((name, bi) => {
    const levels = byBuilding.get(name)
    const top = Math.max(2, ...levels.keys())
    // Верхний этаж без аудиторий — кафедры и кабинеты: корпуса разной высоты.
    const count = Math.min(9, top + (random.chance(0.4) ? 1 : 0))
    const buildingId = seedUuid(id(index, 'campus', 1, 'b', bi))
    const heightMm = random.pick([3300, 3300, 3600])
    return {
      id: buildingId,
      name,
      code: name.split(/\s+/).at(-1).slice(0, 10),
      sortOrder: bi,
      groupPrefix: `b${bi + 1}`,
      usedFillers,
      depthMm: random.pick([15_000, 16_200, 17_400]),
      lifts: count >= 3 ? 2 : 1,
      levels,
      floors: Array.from({ length: count }, (_, i) => ({
        id: seedUuid(id(index, 'campus', 1, 'b', bi, 'f', i + 1)),
        level: i + 1,
        label: String(i + 1),
        kind: 'regular',
        elevationMm: i * heightMm,
        heightMm,
      })),
    }
  })

  // Деканаты — по одному на факультет, вторые этажи корпусов по кругу.
  for (const [fi, faculty] of faculties.entries()) {
    const b = buildings[fi % buildings.length]
    const level = Math.min(2, b.floors.length)
    b.levels.set(level, [
      ...(b.levels.get(level) ?? []),
      { kind: 'dean_office', cells: 1, name: `Деканат: ${faculty.template.name}`.slice(0, 100) },
    ])
  }

  // Корпуса в ряд вдоль будущей аллеи, с разрывами и небольшим сдвигом.
  let cursor = 0
  for (const b of buildings) {
    layoutBuilding(core, b, b.levels, random)
    b.transform = { x: cursor, y: random.randInt(0, 4) * 3000, rotationDeg: 0 }
    cursor += b.lengthMm + random.pick([24_000, 30_000, 36_000])
  }

  const site = buildSite(core, buildings, campusId, random)

  // ── Проверка — та же, что у публикации: ошибки здесь означают битую карту ─────────
  const spaceIds = new Set()
  const floorsInput = []
  const roomOf = {}
  for (const b of buildings) {
    for (const f of b.floors) {
      const doc = core.FloorPlanSchema.parse(f.doc)
      const errors = core
        .validateFloor(doc, { floorHeightMm: f.heightMm })
        .filter((p) => p.severity === 'error' && (linkable || p.code !== 'ROOM_REQUIRED'))
      if (errors.length > 0) {
        const list = errors.slice(0, 5).map((p) => `${p.code} ${p.path}`)
        throw new Error(`Кампус ${uniId}: «${b.name}», этаж ${f.level}: ${list.join(', ')}`)
      }
      for (const spaceId of Object.keys(doc.spaces)) {
        // Индекс версии держит помещения одним ключом на весь кампус.
        if (spaceIds.has(spaceId))
          throw new Error(`Кампус ${uniId}: повтор id помещения ${spaceId}`)
        spaceIds.add(spaceId)
      }
      Object.assign(roomOf, f.links)
      floorsInput.push({
        floorId: f.id,
        buildingId: b.id,
        elevationMm: f.elevationMm,
        doc,
        transform: b.transform,
      })
    }
  }

  // ── Публикация: манифест, индекс помещений и граф маршрутов (campus-publish.service) ─
  const versionId = seedUuid(id(index, 'campus', 1, 'v', 1))
  const manifest = {
    buildings: buildings.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      outline: b.outline,
      transform: b.transform,
      floors: b.floors.map((f) => ({
        id: f.id,
        level: f.level,
        label: f.label,
        kind: f.kind,
        elevationMm: f.elevationMm,
        heightMm: f.heightMm,
      })),
    })),
    site,
  }
  const index_ = floorsInput.flatMap(({ floorId, buildingId, doc, transform }) =>
    core.spaceIndex(doc, transform).map((e) => ({ ...e, floorId, buildingId })),
  )
  const obstacles = buildings.map((b) => b.outline.map((p) => core.toCampus(p, b.transform)))
  const navGraph = core.buildNavGraph(floorsInput, site, obstacles)

  // ── Запись ────────────────────────────────────────────────────────────────────────
  const createdAt = random.randomDate(-150, -90)
  const minutes = (n) => new Date(createdAt.getTime() + n * 60_000)
  const publishedAt = random.randomDate(-60, -7)

  await writer.add('campus', {
    id: campusId,
    universityId: uniId,
    name: 'Главный кампус',
    description: `${profile.name}: учебные корпуса и территория`.slice(0, 1000),
    publishedVersionId: versionId,
    createdById: authorId,
    createdAt,
  })
  for (const b of buildings) {
    await writer.add('campusBuilding', {
      id: b.id,
      campusId,
      name: b.name,
      code: b.code,
      outline: b.outline,
      transform: b.transform,
      sortOrder: b.sortOrder,
      createdAt: minutes(5 + b.sortOrder * 10),
    })
  }
  for (const b of buildings) {
    for (const f of b.floors) {
      await writer.add('campusFloor', {
        id: f.id,
        buildingId: b.id,
        level: f.level,
        label: f.label,
        kind: f.kind,
        elevationMm: f.elevationMm,
        heightMm: f.heightMm,
        createdAt: minutes(5 + b.sortOrder * 10),
      })
    }
  }
  for (const b of buildings) {
    for (const f of b.floors) {
      // Ревизия 2: автопланировка (0 → 1) и связь с аудиториями (1 → 2).
      await writer.add('campusFloorPlan', {
        floorId: f.id,
        format: core.FLOOR_PLAN_FORMAT,
        revision: 2,
        document: f.doc,
        sizeBytes: Buffer.byteLength(JSON.stringify(f.doc)),
        updatedById: authorId,
      })
    }
  }
  for (const b of buildings) {
    for (const f of b.floors) {
      // Первое сохранение кладёт в снимок прежний черновик — голый каркас по контуру.
      const bare = core.floorFromOutline(b.outline, hashedIds(`${f.id}:bare`))
      await writer.add('campusFloorPlanSnapshot', {
        id: seedUuid(id(index, 'campus', 1, 'b', b.sortOrder, 'f', f.level, 'snap', 0)),
        floorId: f.id,
        revision: 0,
        format: core.FLOOR_PLAN_FORMAT,
        document: bare,
        reason: 'autosave',
        createdById: authorId,
        createdAt: minutes(6 + b.sortOrder * 10),
      })
    }
  }
  await writer.add('campusSitePlan', {
    campusId,
    format: core.SITE_PLAN_FORMAT,
    revision: random.randInt(3, 12),
    document: site,
    updatedById: authorId,
  })
  await writer.add('campusVersion', {
    id: versionId,
    campusId,
    number: 1,
    note: 'Первая публикация карты',
    manifest,
    navGraph,
    publishedById: authorId,
    publishedAt,
  })
  for (const f of floorsInput) {
    await writer.add('campusVersionFloor', {
      versionId,
      floorId: f.floorId,
      format: f.doc.format,
      document: f.doc,
    })
  }
  for (const e of index_) {
    await writer.add('campusSpaceIndex', {
      versionId,
      spaceId: e.spaceId,
      buildingId: e.buildingId,
      floorId: e.floorId,
      // Без uuid-аудиторий связи в документе нет — мост из расписания держит индекс.
      roomId: e.roomId ?? roomOf[e.spaceId] ?? null,
      number: e.number,
      name: e.name,
      kind: e.kind,
      visibility: e.visibility,
      centerX: e.center.x,
      centerY: e.center.y,
      areaMm2: BigInt(e.areaMm2),
    })
  }
  await writer.flush()

  return { campusId, versionId, buildings: buildings.length, spaces: index_.length, linkable }
}
