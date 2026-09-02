// Шаг «демо-дополнения»: то, что нужно именно демо-вузу и дашборду платформы.
//
// Здесь собрано содержимое четырёх сидеров-сателлитов, которые раньше лежали отдельными
// файлами в prisma/ (friends, applications, analytics, posts). Отдельные скрипты
// приходилось помнить и запускать руками, а половина их работы теперь делается
// генератором вузов — осталось только то, что генератор не покрывает:
//
//  1. Друзья и заявки в друзья у ИМЕНОВАННЫХ dev-аккаунтов (student@, teacher@ и т.д.).
//     Генератор раздаёт дружбу внутри своих вузов, а панель «Друзья» проверяют, входя
//     именно этими аккаунтами.
//  2. Очередь заявок демо-вуза во всех статусах — экран сотрудника должен быть непустым
//     сразу после `pnpm db:seed`, без генерации сотни вузов.
//  3. История для дашборда платформы: даты регистрации, разнесённые по 90 дням, журнал
//     аудита и воронка инвайтов. Без этого «рост пользователей» — один столбик: сид
//     создаёт всех «сегодня».
//  4. Жалобы демо-вуза для очереди модерации.

import { child } from '../lib/ids.mjs'

const DEMO_UNIVERSITY_ID = 'seed-university-001'

// Именованные dev-аккаунты: по ним ходят и человек, и UI-аудит.
const DEV_EMAILS = [
  'student@studenthub.app',
  'starosta@studenthub.app',
  'teacher@studenthub.app',
  'dean@studenthub.app',
  'university-admin@studenthub.app',
  'university-moderator@studenthub.app',
  'platform-moderator@studenthub.app',
]
// Сколько связей на аккаунт: друзей хватает на две строки сетки 3×2 с запасом
// («показать всех» должно быть чем наполнить), входящих — больше превью в три карточки.
const FRIENDS = 8
const INCOMING = 4
const OUTGOING = 2

// Раскладка очереди заявок демо-вуза: каждая вкладка фильтра непустая, «новые» и
// «в работе» преобладают.
const APP_MIX = [
  ['SUBMITTED', 12],
  ['IN_REVIEW', 9],
  ['IN_PREPARATION', 7],
  ['NEEDS_CORRECTION', 5],
  ['RESUBMITTED', 3],
  ['READY_FOR_PICKUP', 6],
  ['ISSUED', 5],
  ['REJECTED', 2],
  ['CANCELLED', 2],
]
const REJECTIONS = [
  'Нет скана удостоверения личности',
  'Данные в заявке не совпадают с личным делом',
  'Приложен нечитаемый документ',
]
const CORRECTIONS = [
  'Приложите скан удостоверения с обеих сторон',
  'Уточните период, за который нужна справка',
  'Загрузите документ в PDF, а не фотографией',
]
const AUDIT_ACTIONS = [
  'USER_LOGIN',
  'USER_LOGOUT',
  'INVITE_CREATED',
  'INVITE_REVOKED',
  'POST_CREATED',
  'POST_DELETED',
  'COMPLAINT_RESOLVED',
  'USER_BLOCKED',
  'APPLICATION_STATUS_CHANGED',
]
const COMPLAINT_REASONS = [
  'Спам в комментариях',
  'Оскорбление в личных сообщениях',
  'Недостоверная информация в посте',
  'Реклама сторонних услуг',
]

export async function seedDemoExtras(prisma, writer, { random }) {
  const uniId = DEMO_UNIVERSITY_ID

  const dev = await prisma.user.findMany({
    where: { email: { in: DEV_EMAILS } },
    select: { id: true, email: true },
  })
  if (dev.length === 0) return
  const devByEmail = new Map(dev.map((u) => [u.email, u.id]))
  const devIds = new Set(dev.map((u) => u.id))

  // Студенты демо-вуза: кандидаты в друзья, авторы заявок и жалоб.
  const students = await prisma.user.findMany({
    where: { universityId: uniId, role: { in: ['STUDENT', 'STAROSTA'] } },
    select: { id: true, facultyId: true },
    orderBy: { id: 'asc' },
    take: 500,
  })
  const pool = students.filter((s) => !devIds.has(s.id)).map((s) => s.id)
  if (pool.length === 0) return

  // ── 1. Друзья dev-аккаунтов ────────────────────────────────────────────────
  // Дружба уникальна по паре, и настоящую связь (созданную человеком через интерфейс)
  // перетирать нельзя — поэтому пары берём из своего пула и с фиксированными id.
  for (const [di, email] of DEV_EMAILS.entries()) {
    const ownerId = devByEmail.get(email)
    if (!ownerId) continue
    const candidates = random.sample(pool, FRIENDS + INCOMING + OUTGOING)
    let offset = 0

    for (const otherId of candidates.slice(0, FRIENDS)) {
      const created = random.randomDate(-200, -20)
      await writer.add('friendship', {
        id: `seed-demo-fr-${di}-${offset++}`,
        requesterId: di % 2 === 0 ? ownerId : otherId,
        addresseeId: di % 2 === 0 ? otherId : ownerId,
        status: 'ACCEPTED',
        createdAt: created,
        respondedAt: new Date(created.getTime() + 86_400_000),
      })
    }
    // Входящие заявки: их владелец аккаунта видит в «Заявках в друзья».
    for (const otherId of candidates.slice(FRIENDS, FRIENDS + INCOMING)) {
      await writer.add('friendship', {
        id: `seed-demo-fr-${di}-${offset++}`,
        requesterId: otherId,
        addresseeId: ownerId,
        status: 'PENDING',
        createdAt: random.randomDate(-10, -1),
      })
    }
    // Исходящие: «заявка отправлена» на чужом профиле.
    for (const otherId of candidates.slice(FRIENDS + INCOMING)) {
      await writer.add('friendship', {
        id: `seed-demo-fr-${di}-${offset++}`,
        requesterId: ownerId,
        addresseeId: otherId,
        status: 'PENDING',
        createdAt: random.randomDate(-6, -1),
      })
    }
  }
  await writer.flush()

  // ── 2. Очередь заявок демо-вуза ────────────────────────────────────────────
  const services = await prisma.applicationService.findMany({
    where: { universityId: null, active: true },
    select: { id: true, slaHours: true, requirements: { select: { id: true }, take: 1 } },
    take: 10,
  })
  const deanId = devByEmail.get('dean@studenthub.app')
  if (services.length > 0 && deanId) {
    const plan = APP_MIX.flatMap(([status, n]) => Array.from({ length: n }, () => status))
    for (const [ai, status] of plan.entries()) {
      const studentId = pool[ai % pool.length]
      const service = services[ai % services.length]
      const applicationId = `seed-demo-app-${String(ai).padStart(3, '0')}`
      const inWork = !['DRAFT', 'SUBMITTED', 'CANCELLED'].includes(status)
      const isReady = ['READY', 'READY_FOR_PICKUP', 'ISSUED', 'DELIVERED'].includes(status)
      const submittedAt = random.randomDate(-20, -1)
      await writer.add('application', {
        id: applicationId,
        number: `DEMO-${String(ai + 1).padStart(5, '0')}`,
        studentId,
        universityId: uniId,
        facultyId: students.find((s) => s.id === studentId)?.facultyId ?? null,
        serviceId: service.id,
        status,
        deliveryType: 'ELECTRONIC',
        formData: { purpose: 'по месту требования' },
        assignedToId: inWork ? deanId : null,
        assignedAt: inWork ? random.randomDate(-15, -1) : null,
        submittedAt,
        startedAt: inWork ? random.randomDate(-14, -1) : null,
        // Часть заявок намеренно просрочена: индикатор SLA в очереди должен срабатывать.
        dueAt: new Date(submittedAt.getTime() + service.slaHours * 3_600_000),
        readyAt: isReady ? random.randomDate(-7, -1) : null,
        issuedAt: status === 'ISSUED' ? random.randomDate(-6, 0) : null,
        issuedById: status === 'ISSUED' ? deanId : null,
        cancelledAt: status === 'CANCELLED' ? random.randomDate(-6, -1) : null,
        rejectionReason:
          status === 'REJECTED'
            ? random.pick(REJECTIONS)
            : status === 'NEEDS_CORRECTION'
              ? random.pick(CORRECTIONS)
              : null,
        pickupCode: status === 'READY_FOR_PICKUP' ? `DEMO-P${String(ai + 1).padStart(4, '0')}` : null, // prettier-ignore
        pickupLocation: status === 'READY_FOR_PICKUP' ? 'Деканат, кабинет 210' : null,
        createdAt: submittedAt,
      })
      await writer.add('applicationEvent', {
        id: child(applicationId, 'ev', 0),
        applicationId,
        actorId: studentId,
        action: 'CREATED',
        toStatus: 'DRAFT',
        createdAt: submittedAt,
      })
      if (status !== 'DRAFT') {
        await writer.add('applicationEvent', {
          id: child(applicationId, 'ev', 1),
          applicationId,
          actorId: studentId,
          action: 'SUBMITTED',
          fromStatus: 'DRAFT',
          toStatus: 'SUBMITTED',
          createdAt: submittedAt,
        })
      }
      if (inWork) {
        await writer.add('applicationEvent', {
          id: child(applicationId, 'ev', 2),
          applicationId,
          actorId: deanId,
          action: 'ASSIGNED',
          fromStatus: 'SUBMITTED',
          toStatus: 'IN_REVIEW',
          createdAt: random.randomDate(-13, -1),
        })
      }
    }
    await writer.flush()
  }

  // ── 3. Жалобы демо-вуза ────────────────────────────────────────────────────
  const posts = await prisma.post.findMany({
    where: { universityId: uniId },
    select: { id: true },
    take: 10,
  })
  const moderatorId = devByEmail.get('university-moderator@studenthub.app')
  for (let ci = 0; ci < 10 && posts.length > 0; ci += 1) {
    const status = random.pickWeighted([
      ['PENDING', 40],
      ['REVIEWING', 20],
      ['RESOLVED', 30],
      ['DISMISSED', 10],
    ])
    const closed = status === 'RESOLVED' || status === 'DISMISSED'
    const onUser = ci % 3 === 0
    await writer.add('complaint', {
      id: `seed-demo-cmp-${ci}`,
      reporterId: pool[ci % pool.length],
      targetType: onUser ? 'USER' : 'POST',
      targetId: onUser ? pool[(ci + 5) % pool.length] : posts[ci % posts.length].id,
      reason: random.pick(COMPLAINT_REASONS),
      status,
      priority: onUser ? 'HIGH' : 'MEDIUM',
      universityId: uniId,
      resolvedById: closed ? (moderatorId ?? null) : null,
      resolution: closed
        ? status === 'RESOLVED'
          ? 'Контент удалён, автору выдано предупреждение'
          : 'Нарушения не найдено'
        : null,
      resolvedAt: closed ? random.randomDate(-10, -1) : null,
      createdAt: random.randomDate(-30, -1),
    })
  }

  // ── 4. Воронка инвайтов демо-вуза ──────────────────────────────────────────
  const adminId = devByEmail.get('university-admin@studenthub.app')
  if (adminId) {
    const group = await prisma.group.findFirst({
      where: { faculty: { universityId: uniId } },
      select: { id: true, facultyId: true },
    })
    for (const [ii, [role, status]] of [
      ['STUDENT', 'PENDING'],
      ['STUDENT', 'USED'],
      ['STUDENT', 'EXPIRED'],
      ['TEACHER', 'PENDING'],
      ['TEACHER', 'REVOKED'],
      ['STAROSTA', 'PENDING'],
      ['DEAN', 'USED'],
      ['UNIVERSITY_MODERATOR', 'PENDING'],
    ].entries()) {
      await writer.add('invite', {
        id: `seed-demo-inv-${ii}`,
        token: `seed-demo-invite-${ii}-${status.toLowerCase()}`,
        role,
        email: `invite.demo.${ii}@example.kz`,
        universityId: uniId,
        facultyId: group?.facultyId ?? null,
        groupId: role === 'STUDENT' || role === 'STAROSTA' ? (group?.id ?? null) : null,
        status,
        expiresAt: status === 'EXPIRED' ? random.randomDate(-30, -2) : random.randomDate(2, 30),
        createdById: adminId,
        usedById: status === 'USED' ? pool[ii % pool.length] : null,
        usedAt: status === 'USED' ? random.randomDate(-20, -1) : null,
        createdAt: random.randomDate(-40, -1),
      })
    }
  }

  // ── 5. Журнал аудита: DAU/WAU, теплокарта, топ действий ────────────────────
  const actors = [...devByEmail.values(), ...pool.slice(0, 30)]
  for (let ai = 0; ai < 400; ai += 1) {
    const actorId = actors[ai % actors.length]
    const daysAgo = Math.floor((ai / 400) ** 0.6 * 30)
    const at = random.daysFromNow(-daysAgo)
    // Часы рабочего дня: теплокарта активности не должна быть ровной.
    at.setUTCHours(random.pick([9, 10, 11, 12, 14, 15, 16, 17, 20]), random.randInt(0, 59), 0, 0)
    await writer.add('auditLog', {
      id: `seed-demo-audit-${String(ai).padStart(4, '0')}`,
      userId: actorId,
      action: random.pick(AUDIT_ACTIONS),
      entity: random.pick(['User', 'Post', 'Invite', 'Application', 'Complaint']),
      entityId: uniId,
      ip: `10.10.${ai % 255}.${(ai * 7) % 255}`,
      userAgent: random.pick([
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      ]),
      createdAt: at,
    })
  }
  await writer.flush()

  // ── 6. Даты регистрации: разносим по 90 дням ───────────────────────────────
  // Иначе «рост пользователей» на дашборде платформы — один столбик: сид создаёт всех
  // «сегодня». Правим created_at только сидовым аккаунтам (по домену почты), профиль
  // набора растущий: чем ближе к сегодня, тем больше регистраций. Смещение выводится
  // из id — прогон воспроизводим, и повторный прогон не сдвигает даты снова.
  const spread = await prisma.$executeRaw`
    UPDATE "users" SET "created_at" = now() - (
      interval '1 day' * floor(
        90 * (1 - sqrt((abs(hashtext("id")) % 1000)::float / 1000))
      )
    )
    WHERE ("email" LIKE '%@studenthub.app' OR "email" LIKE '%.edu.kz' OR "email" LIKE '%.example.kz')
      AND "created_at" > now() - interval '1 day'
  `
  console.log(`Демо-дополнения: даты регистрации разнесены у ${spread} пользователей`)
}
