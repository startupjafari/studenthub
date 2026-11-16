// Шаг «пост охраны и камеры»: журналы посетителей и проходов студентов, агенты камер,
// камеры, выключатель модуля и журнал просмотров (docs/PROJECT.md §3.10, §3.12).
//
// Без этих строк у охраны и админа вуза пустые экраны «Журнал», «Сводка поста» и «Камеры»:
// проверить фильтры по дню, поиск по ФИО и статусы агентов не на чем.
//
// Данные повторяют то, что пишут сервисы, а не «что-нибудь похожее»:
// - посетителя записывает охранник своей смены; документ — тип и четыре последние цифры,
//   цифры без типа не бывает (CreateVisitorSchema); выход — позже входа, без выхода только
//   те, кто вошёл сегодня и ещё в здании;
// - проход пишет проверка студенческого (StudentIdService.verify): отказ по истёкшему,
//   битому коду и чужому вузу — без студента, по повтору кода и блокировке — со студентом;
// - сессия просмотра: lastSeenAt — шагами подтверждения плеера (30 с), endedAt — у части
//   нет (закрыли вкладку), смотрят только охрана и админ вуза и только включённые камеры.
//
// История — 120 дней: журналы хранятся год (purgeViewLogs), старше года в них строк нет.
//
// Видео нет и не будет: агент «сервер охраны» выходил на связь несколько дней назад и
// пропал (OFFLINE), агент общежития заведён, но ни разу не запускался (NEVER). Токен
// агента в базе — SHA-256 случайного значения: сид льют и в общую базу, и выводимый из
// репозитория токен был бы готовым входом для чужого агента. Адреса потоков — в зоне
// .invalid, которая не резолвится нигде.

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { person, phone } from '../data/people.mjs'
import { id } from '../lib/ids.mjs'

const DAY_MS = 86_400_000
const MIN_MS = 60_000
// Глубина истории журналов. Год — потолок хранения; четырёх месяцев хватает на графики
// и фильтры по дням, а объём на сотне вузов остаётся умеренным.
const WINDOW_DAYS = 120
// Вузы платформы — в Казахстане, с марта 2024 вся страна в UTC+5 (как в 45-library).
const TZ_OFFSET_H = 5
// Доля студентов, которые проходят по QR студенческого (остальные — по карте турникета
// или вовсе не попадают на пост с проверкой).
const QR_USERS_SHARE = 0.15
// Шаг подтверждения просмотра плеером (VIEW_HEARTBEAT_S в camera-views.service.ts).
const VIEW_HEARTBEAT_S = 30
// Версия агента камер (apps/camera-agent/src/version.ts).
const AGENT_VERSION = '0.1.0'

// Цель визита. Шаблоны с подстановкой — из структуры вуза, остальные как есть.
const VISITOR_PURPOSES = [
  'Курьер: документы в приёмную ректора',
  'Курьер: доставка в бухгалтерию',
  'Курьер: посылка в библиотеку',
  'Подрядчик: ремонт вентиляции, корпус Б',
  'Сервисный инженер: обслуживание принтеров',
  'Приёмная комиссия: консультация абитуриента',
  'Бухгалтерия: оплата обучения',
  'Отдел кадров: собеседование',
  'Мероприятие в актовом зале',
  'Военный стол: постановка на учёт',
] // prettier-ignore

// Документ посетителя: удостоверение — основной, без документа — редкость (пустили по
// звонку из деканата).
const DOCUMENT_TYPES = [
  ['ID_CARD', 70],
  ['PASSPORT', 10],
  ['DRIVER_LICENSE', 10],
  ['OTHER', 3],
  [null, 7],
]

// Исход проверки студенческого. STATUS не генерируется: у всех студентов сида учебный
// статус ACTIVE, а отказ «отчислен» при активном статусе — состояние, которого нет.
const PASS_OUTCOMES = [
  ['ALLOWED', 920],
  ['EXPIRED_QR', 30],
  ['OTHER_UNIVERSITY', 15],
  ['REUSED_QR', 15],
  ['INVALID_QR', 10],
  ['BLOCKED', 10],
]

const GUARD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' // prettier-ignore
const ADMIN_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', // prettier-ignore
  'StudentHub/1.0 (iPhone; iOS 26.1; Scale/3.00)',
]

// Секрет, который нельзя вывести из репозитория: хэш случайного значения, как у живых
// инвайтов в 30-people.mjs. Сам исходник нигде не сохраняется.
function unguessableHash() {
  return createHash('sha256').update(randomUUID()).digest('hex')
}

/**
 * Местные сутки окна истории, от самых старых к сегодняшним. `start` — полночь по UTC+5 в
 * миллисекундах UTC; `key` — дата YYYYMMDD для id: повторный прогон в другой день не
 * сдвигает строки уже записанных дней.
 */
function localDays(now) {
  const local = new Date(now + TZ_OFFSET_H * 3_600_000)
  const todayStart =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    TZ_OFFSET_H * 3_600_000
  const days = []
  for (let d = WINDOW_DAYS; d >= 0; d -= 1) {
    const start = todayStart - d * DAY_MS
    const date = new Date(start + TZ_OFFSET_H * 3_600_000)
    days.push({
      start,
      // Номер суток от эпохи — для графика смен: не зависит от даты прогона.
      serial: Math.round(start / DAY_MS),
      key: date.toISOString().slice(0, 10).replace(/-/g, ''),
      // 0 — воскресенье, 6 — суббота.
      weekday: date.getUTCDay(),
    })
  }
  return days
}

const fullName = (u) => `${u.lastName} ${u.firstName}`

export async function seedSecurity(prisma, writer, ctx) {
  const { index, random, structure, people } = ctx
  const { uniId, rooms } = structure
  const now = Date.now()
  const days = localDays(now)

  // ── Кто есть кто: имена для снимков в журналах ──────────────────────────────
  // Журналы хранят имя рядом с id (запись читается и после удаления аккаунта), а люди
  // шага 30 имён наружу не отдают — берём из базы одним запросом.
  const guardIds = people.securityGuardIds?.length ? people.securityGuardIds : [people.adminId]
  const deans = people.faculties.map((f) => ({ id: f.deanId, faculty: f.template.name }))
  const teacherIds = people.faculties.flatMap((f) => f.teacherIds.slice(0, 3))
  const staffIds = [...guardIds, people.adminId, ...deans.map((d) => d.id), ...teacherIds]
  const staff = await prisma.user.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, firstName: true, lastName: true },
    take: staffIds.length,
  })
  const nameOf = new Map(staff.map((u) => [u.id, fullName(u)]))
  const staffById = new Map(staff.map((u) => [u.id, u]))
  const guardName = (guardId) => nameOf.get(guardId) ?? 'Охрана'
  // Смена «сутки через сутки»: дежурный определяется номером суток, а не порядком обхода.
  const onDuty = (day) => guardIds[day.serial % guardIds.length]
  const otherGuard = (guardId) =>
    guardIds.length > 1 ? guardIds[(guardIds.indexOf(guardId) + 1) % guardIds.length] : guardId

  // Цели визита из структуры вуза: деканаты, преподаватели, группы.
  const purposes = [...VISITOR_PURPOSES]
  for (const dean of deans) {
    const d = staffById.get(dean.id)
    if (d) purposes.push(`Деканат: ${dean.faculty}, к декану ${d.lastName} ${d.firstName[0]}.`)
  }
  for (const teacherId of teacherIds) {
    const t = staffById.get(teacherId)
    if (t) purposes.push(`К преподавателю ${t.lastName} ${t.firstName[0]}.: консультация`)
  }
  for (const faculty of people.faculties) {
    const group = faculty.groups[0]
    if (group) purposes.push(`Родитель: встреча с куратором группы ${group.name}`)
  }

  // ── Журнал посетителей ──────────────────────────────────────────────────────
  // Будни — 5–30 человек, суббота — немного, в воскресенье корпус закрыт.
  for (const day of days) {
    const count =
      day.weekday === 0 ? 0 : day.weekday === 6 ? random.randInt(0, 6) : random.randInt(5, 30)
    const guardId = onDuty(day)
    for (let n = 0; n < count; n += 1) {
      // Вход 08:00–18:30 по местному времени, секунды — чтобы записи не сливались.
      const enteredAt = new Date(
        day.start + random.randInt(8 * 60, 18 * 60 + 30) * MIN_MS + random.randInt(0, 59) * 1000,
      )
      // Сегодняшний вечер ещё не наступил: записи «из будущего» в журнале не бывает.
      if (enteredAt.getTime() > now) continue
      const purpose = random.pick(purposes)
      const courier = purpose.startsWith('Курьер')
      const stayMin = courier ? random.randInt(5, 20) : random.randInt(20, 180)
      const exitAt = enteredAt.getTime() + stayMin * MIN_MS + random.randInt(0, 59) * 1000
      // Выход в будущем — человек ещё в здании (сегодняшние визиты).
      const exited = exitAt <= now
      const exitedById = exited ? (random.chance(0.85) ? guardId : otherGuard(guardId)) : null

      const visitor = person(random.randInt(0, 1), random)
      const documentType = random.pickWeighted(DOCUMENT_TYPES)
      // «Другой документ» бывает без номера; у остальных — четыре последние цифры.
      const withDigits = documentType !== null && (documentType !== 'OTHER' || random.chance(0.5))

      await writer.add('securityVisitor', {
        id: id(index, 'secv', day.key, n),
        universityId: uniId,
        fullName: `${visitor.lastName} ${visitor.firstName} ${visitor.middleName}`,
        purpose,
        documentType,
        documentLast4: withDigits ? String(random.randInt(0, 9999)).padStart(4, '0') : null,
        phone: random.chance(0.7) ? phone(random) : null,
        enteredAt,
        exitedAt: exited ? new Date(exitAt) : null,
        createdById: guardId,
        createdByName: guardName(guardId),
        exitedById,
      })
    }
  }

  // ── Журнал проходов студентов ───────────────────────────────────────────────
  const groupName = new Map()
  const allStudents = []
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      groupName.set(group.id, group.name)
      allStudents.push(...group.studentIds)
    }
  }
  const qrIds = random.sample(allStudents, Math.max(20, Math.round(allStudents.length * QR_USERS_SHARE))) // prettier-ignore
  const qrUsers = await prisma.user.findMany({
    where: { id: { in: qrIds } },
    select: { id: true, firstName: true, lastName: true, groupId: true, isBlocked: true },
    take: qrIds.length,
  })
  // Заблокированные — из всего вуза: в выборку их почти не попадает, а отказ BLOCKED
  // пишется только про студента своего вуза.
  const blocked = await prisma.user.findMany({
    where: { universityId: uniId, role: { in: ['STUDENT', 'STAROSTA'] }, isBlocked: true },
    select: { id: true, firstName: true, lastName: true, groupId: true },
    take: 50,
  })
  const passable = qrUsers.filter((u) => !u.isBlocked)
  const asStudent = (u) => ({
    studentId: u.id,
    studentName: fullName(u),
    studentGroup: groupName.get(u.groupId) ?? null,
  })
  const noStudent = { studentId: null, studentName: null, studentGroup: null }

  for (const day of passable.length > 0 ? days : []) {
    if (day.weekday === 0) continue
    const base = random.randInt(
      Math.round(passable.length * 0.2),
      Math.round(passable.length * 0.45),
    )
    const count = day.weekday === 6 ? Math.round(base / 4) : base
    const guardId = onDuty(day)
    // Один студент — один проход в день: без повторов внутри суток.
    const students = random.sample(passable, count)
    for (const [n, student] of students.entries()) {
      // Пик утром к первой паре, второй — после обеда, остальное — равномерно.
      const slot = random.pickWeighted([
        ['morning', 60],
        ['noon', 25],
        ['day', 15],
      ])
      const minute =
        slot === 'morning'
          ? random.randInt(7 * 60 + 45, 9 * 60 + 10)
          : slot === 'noon'
            ? random.randInt(12 * 60 + 30, 14 * 60 + 10)
            : random.randInt(9 * 60, 17 * 60)
      const createdAt = new Date(day.start + minute * MIN_MS + random.randInt(0, 59) * 1000)
      if (createdAt.getTime() > now) continue

      let outcome = random.pickWeighted(PASS_OUTCOMES)
      if (outcome === 'BLOCKED' && blocked.length === 0) outcome = 'INVALID_QR'
      // Студент в записи — как у сервиса: при пропуске и повторе кода — владелец карты,
      // при блокировке — заблокированный своего вуза, в остальных отказах — никого.
      const subject =
        outcome === 'ALLOWED' || outcome === 'REUSED_QR'
          ? asStudent(student)
          : outcome === 'BLOCKED'
            ? asStudent(random.pick(blocked))
            : noStudent

      await writer.add('securityPass', {
        id: id(index, 'secp', day.key, n),
        universityId: uniId,
        guardId,
        guardName: guardName(guardId),
        ...subject,
        allowed: outcome === 'ALLOWED',
        denyReason: outcome === 'ALLOWED' ? null : outcome,
        createdAt,
      })
    }
  }

  // ── Агенты камер ────────────────────────────────────────────────────────────
  // Главный корпус: агент работал и пропал несколько дней назад — экран показывает «не на
  // связи» и статусы камер «неизвестно». Общежитие: заведён, но ни разу не запускался.
  const adminId = people.adminId
  const mainCreated = now - random.randInt(100, 110) * DAY_MS
  const mainLastSeen = now - random.randInt(2, 6) * DAY_MS - random.randInt(0, 600) * MIN_MS
  const mainAgent = {
    id: id(index, 'camagent', 'main'),
    universityId: uniId,
    name: 'Главный корпус — сервер охраны',
    tokenHash: unguessableHash(),
    // Открытый ключ X25519 (32 байта, base64url). Закрытого ключа нет ни у кого: камер с
    // паролем сид не заводит, и запечатывать этим ключом нечего.
    publicKey: randomBytes(32).toString('base64url'),
    version: AGENT_VERSION,
    lastSeenAt: new Date(mainLastSeen),
    createdById: adminId,
    createdAt: new Date(mainCreated),
    updatedAt: new Date(mainLastSeen),
  }
  const dormCreated = now - random.randInt(5, 15) * DAY_MS
  const dormAgent = {
    id: id(index, 'camagent', 'dorm'),
    universityId: uniId,
    name: 'Общежитие №1',
    tokenHash: unguessableHash(),
    publicKey: null,
    version: null,
    lastSeenAt: null,
    createdById: adminId,
    createdAt: new Date(dormCreated),
    updatedAt: new Date(dormCreated),
  }
  await writer.add('cameraAgent', mainAgent)
  await writer.add('cameraAgent', dormAgent)

  // ── Камеры ──────────────────────────────────────────────────────────────────
  // [имя, помещение (id или null), последний отчёт агента, включена]
  const srv = (kind) => id(index, 'srv', kind)
  // Лаборатория — каждое седьмое помещение (20-structure.mjs), шестое есть всегда.
  const labRoom = rooms[6] ?? null
  const mainCameras = [
    ['Главный вход, корпус А', null, 'ONLINE', true],
    ['Вход, корпус Б', null, 'ONLINE', true],
    ['Холл первого этажа', null, 'ONLINE', true],
    ['Коридор, 2 этаж', null, 'ONLINE', true],
    ['Коридор, 3 этаж', null, 'OFFLINE', true],
    ['Библиотека, читальный зал', srv('library'), 'ONLINE', true],
    ['Столовая', srv('canteen'), 'ONLINE', true],
    ['Спортивный зал', srv('sport_hall'), 'ONLINE', true],
    ['Актовый зал', srv('assembly_hall'), 'ONLINE', true],
    ['Лаборатория, вход', labRoom, 'ONLINE', true],
    ['Парковка, въезд', null, 'AUTH_FAILED', true],
    // Отключена админом: охрана её не видит, просмотров после отключения нет.
    ['Серверная', null, 'OFFLINE', false],
  ]
  const viewable = []
  for (const [n, [name, roomId, status, enabled]] of mainCameras.entries()) {
    const cameraId = id(index, 'cam', 'main', n)
    const createdAt = new Date(mainCreated + random.randInt(0, 3) * DAY_MS + random.randInt(60, 600) * MIN_MS) // prettier-ignore
    // Агент обновляет lastSeenAt камеры только при отчёте ONLINE: у сбойных — давний.
    const lastSeenAt =
      status === 'ONLINE'
        ? new Date(mainLastSeen)
        : new Date(mainLastSeen - random.randInt(3, 30) * DAY_MS)
    await writer.add('camera', {
      id: cameraId,
      universityId: uniId,
      agentId: mainAgent.id,
      roomId,
      name,
      streamUrl: `rtsp://cam-${String(n + 1).padStart(2, '0')}.${uniId}.invalid:554/Streaming/Channels/102`, // prettier-ignore
      // Пароля нет: конверт запечатывается ключом агента, а закрытого ключа у сида нет.
      credentialsSealed: null,
      enabled,
      status,
      lastSeenAt,
      createdAt,
      updatedAt: new Date(mainLastSeen),
    })
    if (enabled) viewable.push({ id: cameraId, name, createdAt: createdAt.getTime() })
  }
  const dormCameras = [
    ['Общежитие: вход', null],
    ['Общежитие: холл', srv('dormitory')],
    ['Общежитие: коридор 1 этажа', null],
  ]
  for (const [n, [name, roomId]] of dormCameras.entries()) {
    const createdAt = new Date(dormCreated + random.randInt(10, 120) * MIN_MS)
    await writer.add('camera', {
      id: id(index, 'cam', 'dorm', n),
      universityId: uniId,
      agentId: dormAgent.id,
      roomId,
      name,
      streamUrl: `rtsp://dorm-cam-${String(n + 1).padStart(2, '0')}.${uniId}.invalid:554/stream1`,
      credentialsSealed: null,
      enabled: true,
      // Агент ни разу не отчитывался — статус по умолчанию.
      status: 'UNKNOWN',
      lastSeenAt: null,
      createdAt,
      updatedAt: createdAt,
    })
  }

  // ── Выключатель модуля ──────────────────────────────────────────────────────
  // Включил админ через день после заведения агента; до этого просмотров быть не могло.
  const enabledAt = mainCreated + DAY_MS + random.randInt(60, 480) * MIN_MS
  await writer.add('cameraSettings', {
    universityId: uniId,
    enabled: true,
    updatedById: adminId,
    updatedAt: new Date(enabledAt),
  })

  // ── Журнал просмотров ───────────────────────────────────────────────────────
  // Охрана смотрит круглосуточно (пост работает и ночью), админ — иногда в будни. Просмотр
  // возможен только пока модуль включён и агент на связи: от enabledAt до mainLastSeen.
  const guardIp = `203.0.113.${(index % 250) + 1}`
  const adminIp = `198.51.100.${(index % 250) + 1}`
  const adminUa = random.pick(ADMIN_UAS)
  for (const day of days) {
    if (day.start + DAY_MS < enabledAt || day.start > mainLastSeen) continue
    const sessions = []
    const guardId = onDuty(day)
    for (let k = random.randInt(2, 7); k > 0; k -= 1) {
      const minute = random.chance(0.7) ? random.randInt(8 * 60, 20 * 60) : random.randInt(0, 1439)
      sessions.push({ userId: guardId, minute, ip: guardIp, userAgent: GUARD_UA })
    }
    if (day.weekday >= 1 && day.weekday <= 5 && random.chance(0.25)) {
      for (let k = random.randInt(1, 2); k > 0; k -= 1) {
        const minute = random.randInt(9 * 60, 18 * 60)
        sessions.push({ userId: adminId, minute, ip: adminIp, userAgent: adminUa })
      }
    }
    for (const [n, s] of sessions.entries()) {
      const startedAt = day.start + s.minute * MIN_MS + random.randInt(0, 59) * 1000
      const camera = random.pick(viewable)
      if (startedAt < enabledAt || startedAt < camera.createdAt) continue
      // Подтверждения идут каждые 30 с: lastSeenAt — последнее из них.
      const beats = Math.floor(random.randInt(40, 2400) / VIEW_HEARTBEAT_S)
      const lastSeenAt = startedAt + beats * VIEW_HEARTBEAT_S * 1000
      if (lastSeenAt > mainLastSeen) continue
      // Часть просмотров без явного конца: закрыли вкладку, пропала сеть.
      const endedAt = random.chance(0.8) ? new Date(lastSeenAt + random.randInt(1, 20) * 1000) : null // prettier-ignore
      await writer.add('cameraViewSession', {
        id: id(index, 'camview', day.key, n),
        universityId: uniId,
        cameraId: camera.id,
        cameraName: camera.name,
        userId: s.userId,
        userName: nameOf.get(s.userId) ?? s.userId,
        startedAt: new Date(startedAt),
        lastSeenAt: new Date(lastSeenAt),
        endedAt,
        ip: s.ip,
        userAgent: s.userAgent,
      })
    }
  }

  await writer.flush()
}
