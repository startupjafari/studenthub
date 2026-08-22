// Демо-данные для дашборда аналитики платформы (dev-only).
//
// Зачем отдельно от prisma/seed.mjs: основной seed создаёт всех пользователей
// «сегодня», поэтому график роста выглядит как одинокий столб, а жалоб, инвайтов
// и журнала аудита почти нет — дашборд формально работает, но смотреть не на что.
// Здесь дозаполняем ровно те сущности, на которых стоят диаграммы.
//
// Свойства скрипта:
//  · детерминированный PRNG — прогон даёт те же данные, что и предыдущий;
//  · только добавление и правка created_at у seed-пользователей: ничего не удаляет;
//  · идемпотентен по фиксированным id (`analytics-*`) + skipDuplicates;
//  · пользователей НЕ создаёт: счётчики платформы остаются честными.
//
// Запуск: DATABASE_URL=... node prisma/seed-analytics.mjs

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Детерминированный PRNG (mulberry32) — как в основном seed'е.
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = makeRng(20260822)
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))
const chance = (p) => rng() < p

/** Детерминированное перемешивание (Фишер—Йетс на том же PRNG). */
function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const HOUR = 3_600_000
const DAY = 86_400_000
const now = Date.now()
/** Глубина истории: графики дашборда смотрят на 30 дней, рост — шире. */
const GROWTH_DAYS = 90
const WINDOW_DAYS = 30

const ago = (ms) => new Date(now - ms)

// ── 1. Рост пользователей: разносим даты регистрации по 90 дням ──────────────
// Правим created_at существующим seed-пользователям, а не создаём новых: иначе
// «Пользователей» в плитке раздуется, а вузу припишутся студенты-фантомы.
// Профиль набора — растущий: чем ближе к сегодня, тем больше регистраций.
async function spreadSignups() {
  const found = await prisma.user.findMany({
    where: {
      deletedAt: null,
      // Платформенные роли — не часть «роста вузов», их даты не трогаем.
      role: { notIn: ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR'] },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 5000,
  })
  if (found.length === 0) return 0

  // Перемешиваем ОБЯЗАТЕЛЬНО: id основного seed'а сгруппированы по ролям
  // (`seed-st-*` студенты, `seed-t-*` преподаватели), и при выдаче дней по порядку
  // роль начинала коррелировать с датой — на графике роста студенты занимали начало
  // периода, а преподаватели скакали в самом конце. Порядок сортировки фиксирован,
  // PRNG детерминирован, поэтому результат всё равно воспроизводим.
  const users = shuffle(found)

  // Вес дня растёт линейно: у дня 0 (90 дней назад) вес 1, у последнего — 4.
  const weights = Array.from({ length: GROWTH_DAYS }, (_, i) => 1 + (3 * i) / (GROWTH_DAYS - 1))
  const total = weights.reduce((a, b) => a + b, 0)

  let cursor = 0
  const updates = []
  for (let day = 0; day < GROWTH_DAYS; day++) {
    const share = Math.round((weights[day] / total) * users.length)
    for (let k = 0; k < share && cursor < users.length; k++, cursor++) {
      // Разброс внутри дня по рабочим часам — иначе все в 00:00.
      const at = ago((GROWTH_DAYS - 1 - day) * DAY - randInt(8, 22) * HOUR)
      updates.push(
        prisma.user.update({
          where: { id: users[cursor].id },
          data: { createdAt: at },
        }),
      )
    }
  }
  // Остаток от округления раскидываем по последней трети периода, а НЕ сваливаем
  // на сегодня: иначе на графике роста последний день даёт вертикальный скачок,
  // который выглядит как сбой, а не как данные.
  const tailFrom = Math.floor(GROWTH_DAYS / 3)
  for (; cursor < users.length; cursor++) {
    const day = randInt(tailFrom, GROWTH_DAYS - 2)
    updates.push(
      prisma.user.update({
        where: { id: users[cursor].id },
        data: { createdAt: ago((GROWTH_DAYS - 1 - day) * DAY - randInt(8, 22) * HOUR) },
      }),
    )
  }

  // Батчами: 400 апдейтов одной транзакцией кладут пул соединений.
  const BATCH = 100
  for (let i = 0; i < updates.length; i += BATCH) {
    await prisma.$transaction(updates.slice(i, i + BATCH))
  }
  return updates.length
}

// ── 2. Жалобы: поток + распределение времени разбора ─────────────────────────
const COMPLAINT_REASONS = [
  'Оскорбления в комментариях',
  'Спам в ленте',
  'Неприемлемый контент на фото',
  'Чужие персональные данные в посте',
  'Реклама сторонних курсов',
  'Флуд в чате группы',
  'Агрессия в личных сообщениях',
  'Плагиат в статье',
]
const TARGET_TYPES = ['POST', 'COMMENT', 'MESSAGE', 'USER']

/**
 * Задержка разбора: смесь, дающая читаемую гистограмму — основная масса в первые
 * сутки, заметный хвост за неделю (именно его на дашборде и ищут).
 */
function resolutionDelayMs() {
  const r = rng()
  if (r < 0.3) return randInt(5, 55) * 60_000 // до часа
  if (r < 0.55) return randInt(1, 3) * HOUR + randInt(0, 59) * 60_000 // 1–4 ч
  if (r < 0.78) return randInt(4, 23) * HOUR // 4–24 ч
  if (r < 0.9) return randInt(1, 2) * DAY + randInt(0, 23) * HOUR // 1–3 дн.
  if (r < 0.97) return randInt(3, 6) * DAY // 3–7 дн.
  return randInt(7, 21) * DAY // хвост
}

async function seedComplaints(reporters, resolvers, universityId) {
  const rows = []
  for (let i = 0; i < 140; i++) {
    // Поток по последним 30 дням, с провалами на выходных.
    const daysBack = Math.floor(rng() * WINDOW_DAYS)
    const createdAt = ago(daysBack * DAY + randInt(0, 23) * HOUR + randInt(0, 59) * 60_000)
    const weekday = createdAt.getUTCDay()
    if ((weekday === 0 || weekday === 6) && chance(0.6)) continue

    // Свежие жалобы чаще ещё в очереди — так плитка «в очереди» не нулевая.
    const stillOpen = daysBack < 3 ? chance(0.7) : chance(0.08)
    const delay = resolutionDelayMs()
    const resolvedTime = createdAt.getTime() + delay
    const resolved = !stillOpen && resolvedTime < now

    rows.push({
      id: `analytics-complaint-${i}`,
      reporterId: pick(reporters),
      targetType: pick(TARGET_TYPES),
      targetId: `analytics-target-${randInt(1, 400)}`,
      reason: pick(COMPLAINT_REASONS),
      universityId,
      status: resolved ? (chance(0.7) ? 'RESOLVED' : 'DISMISSED') : 'PENDING',
      resolvedById: resolved ? pick(resolvers) : null,
      resolution: resolved ? (chance(0.7) ? 'Контент удалён' : 'Нарушения не выявлено') : null,
      resolvedAt: resolved ? new Date(resolvedTime) : null,
      createdAt,
      updatedAt: resolved ? new Date(resolvedTime) : createdAt,
    })
  }
  const res = await prisma.complaint.createMany({ data: rows, skipDuplicates: true })
  return res.count
}

// ── 3. Инвайты: воронка со статусами ────────────────────────────────────────
async function seedInvites(creatorId, universityId, groupId) {
  const rows = []
  for (let i = 0; i < 120; i++) {
    const daysBack = Math.floor(rng() * WINDOW_DAYS)
    const createdAt = ago(daysBack * DAY + randInt(0, 23) * HOUR)
    const expiresAt = new Date(createdAt.getTime() + 14 * DAY)

    // Конверсия ~60%, остальное — ожидает, истекло, отозвано.
    const r = rng()
    let status = 'USED'
    if (r > 0.62 && r <= 0.78) status = 'PENDING'
    else if (r > 0.78 && r <= 0.93) status = 'EXPIRED'
    else if (r > 0.93) status = 'REVOKED'
    // Просроченным по дате не даём остаться в PENDING — иначе статус врёт.
    if (status === 'PENDING' && expiresAt.getTime() < now) status = 'EXPIRED'

    rows.push({
      id: `analytics-invite-${i}`,
      token: `analytics-invite-token-${i}`,
      role: chance(0.85) ? 'STUDENT' : 'TEACHER',
      email: `demo${i}@studenthub.app`,
      universityId,
      facultyId: null,
      groupId: chance(0.8) ? groupId : null,
      status,
      expiresAt,
      createdById: creatorId,
      usedById: null,
      usedAt: status === 'USED' ? new Date(createdAt.getTime() + randInt(1, 72) * HOUR) : null,
      createdAt,
      updatedAt: createdAt,
    })
  }
  const res = await prisma.invite.createMany({ data: rows, skipDuplicates: true })
  return res.count
}

// ── 4. Журнал аудита: DAU/WAU, теплокарта, топ действий ─────────────────────
// Частоты подобраны так, чтобы топ действий выглядел правдоподобно: логины и
// обновления токена доминируют, административные операции редки.
const ACTION_WEIGHTS = [
  ['login', 30],
  ['refresh', 26],
  ['logout', 12],
  ['post_created', 8],
  ['attendance_marked', 7],
  ['grades_saved', 5],
  ['material_created', 4],
  ['invite_created', 3],
  ['complaint_created', 2],
  ['complaint_resolved', 2],
  ['pair_updated', 2],
  ['room_qr_issued', 1],
  ['PROFILE_VIEW_PRIVATE', 1],
  ['university_status_changed', 1],
]
const ACTION_POOL = ACTION_WEIGHTS.flatMap(([action, w]) => Array.from({ length: w }, () => action))

/** Профиль суток: ночью почти тихо, два пика — утро и вечер. */
const HOUR_WEIGHT = [
  1, 1, 1, 1, 1, 2, 4, 8, 14, 18, 20, 19, 16, 18, 20, 19, 17, 15, 20, 22, 18, 12, 7, 3,
]
const HOUR_POOL = HOUR_WEIGHT.flatMap((w, h) => Array.from({ length: w }, () => h))

async function seedAuditLogs(actorIds) {
  const rows = []
  let seq = 0
  for (let day = 0; day < WINDOW_DAYS; day++) {
    const date = new Date(now - day * DAY)
    const weekday = date.getUTCDay()
    // Выходные тише втрое — иначе теплокарта равномерная и бесполезная.
    const base = weekday === 0 || weekday === 6 ? randInt(20, 45) : randInt(90, 170)
    // Активных пользователей в день — подмножество: так DAU < общего числа.
    const dayActors = Array.from({ length: randInt(12, 40) }, () => pick(actorIds))

    for (let i = 0; i < base; i++) {
      const hour = pick(HOUR_POOL)
      const at = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          hour,
          randInt(0, 59),
          randInt(0, 59),
        ),
      )
      if (at.getTime() > now) continue
      rows.push({
        id: `analytics-audit-${seq++}`,
        userId: pick(dayActors),
        action: pick(ACTION_POOL),
        entity: null,
        entityId: null,
        ip: `10.0.${randInt(0, 8)}.${randInt(2, 250)}`,
        userAgent: 'Mozilla/5.0 (seed-analytics)',
        createdAt: at,
      })
    }
  }
  // Пишем порциями: один createMany на несколько тысяч строк упирается в лимит параметров.
  const BATCH = 1000
  let count = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await prisma.auditLog.createMany({
      data: rows.slice(i, i + BATCH),
      skipDuplicates: true,
    })
    count += res.count
  }
  return count
}

// ── Прогон ───────────────────────────────────────────────────────────────────
async function main() {
  const university = await prisma.university.findFirst({ select: { id: true } })
  if (!university) {
    throw new Error('Нет ни одного вуза — сначала выполните prisma/seed.mjs')
  }

  const students = await prisma.user.findMany({
    where: { deletedAt: null, role: { in: ['STUDENT', 'STAROSTA'] } },
    select: { id: true },
    take: 500,
  })
  const staff = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: { in: ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR', 'UNIVERSITY_ADMIN', 'DEAN', 'TEACHER'] },
    },
    select: { id: true },
    take: 200,
  })
  if (students.length === 0 || staff.length === 0) {
    throw new Error('Недостаточно пользователей — сначала выполните prisma/seed.mjs')
  }

  const group = await prisma.group.findFirst({ select: { id: true } })
  const studentIds = students.map((u) => u.id)
  const staffIds = staff.map((u) => u.id)
  const allIds = [...studentIds, ...staffIds]

  const signups = await spreadSignups()
  console.log(`даты регистрации разнесены по ${GROWTH_DAYS} дням: ${signups} пользователей`)

  const complaints = await seedComplaints(studentIds, staffIds, university.id)
  console.log(`жалоб добавлено: ${complaints}`)

  const invites = await seedInvites(staffIds[0], university.id, group?.id ?? null)
  console.log(`инвайтов добавлено: ${invites}`)

  const audit = await seedAuditLogs(allIds)
  console.log(`записей аудита добавлено: ${audit}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
