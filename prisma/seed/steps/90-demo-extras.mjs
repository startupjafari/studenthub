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
//  5. Заявки вузов на тестирование — чтобы очередь платформенного админа была непустой.
//  6. Состояние платформы, прочитанные «Что нового» и настройки уведомлений демо-вуза —
//     рычаги мини-аппа и экраны настроек не должны впервые открываться пустыми.

import { readFileSync } from 'node:fs'
import { child } from '../lib/ids.mjs'

const DEMO_UNIVERSITY_ID = 'seed-university-001'

// Именованные dev-аккаунты: по ним ходят и человек, и e2e.
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
/**
 * Заявки вузов на тестирование (PROJECT.md §31): по одной на каждую вкладку очереди.
 *
 * Названия ВЫДУМАННЫЕ, в отличие от справочника вузов в prisma/seed/data. Заявка — это
 * утверждение «вот этот вуз к нам просился», и подставлять в него настоящее название
 * нельзя ни на каком стенде: строка переживает стенд, а вуз о ней не знает.
 */
const DEMO_REQUESTS = [
  {
    status: 'NEW',
    universityName: 'Прикаспийский технический институт',
    city: 'Актау',
    contactName: 'Сауле Ахметова',
    contactRole: 'Проректор по цифровизации',
    email: 'saule.a@pti.example.kz',
    phone: '+7 701 000 11 22',
    studentsEstimate: 3800,
    comment: 'Интересует расписание и электронный журнал. Готовы начать с двух факультетов.',
    daysAgo: 2,
  },
  {
    status: 'NEW',
    universityName: 'Академия транспорта и логистики',
    city: 'Астана',
    contactName: 'Данияр Оспанов',
    contactRole: 'Начальник учебного отдела',
    email: 'd.ospanov@atl.example.kz',
    studentsEstimate: 1200,
    daysAgo: 6,
  },
  {
    status: 'APPROVED',
    universityName: 'Северный педагогический университет',
    city: 'Петропавловск',
    contactName: 'Гульнара Ибраева',
    contactRole: 'Ректор',
    email: 'rector@npu.example.kz',
    studentsEstimate: 7400,
    daysAgo: 21,
  },
  {
    status: 'REJECTED',
    universityName: 'Языковые курсы «Полиглот»',
    city: 'Алматы',
    contactName: 'Марат Ким',
    email: 'info@poliglot.example.kz',
    studentsEstimate: 140,
    rejectionReason: 'NOT_ELIGIBLE',
    reviewNote: 'Курсы, а не организация образования',
    daysAgo: 14,
  },
  {
    // В список очереди без явного фильтра НЕ попадает: адрес не подтверждён, это
    // брошенная форма, а не заявка. Лежит здесь ровно затем, чтобы это было видно.
    status: 'PENDING_EMAIL',
    universityName: 'Институт прикладной механики',
    contactName: 'Ержан Тулеуов',
    email: 'e.tuleuov@ipm.example.kz',
    daysAgo: 1,
  },
  // Остальные причины отказа (DemoRejectionReason): у каждой свой ответ заявителю —
  // «можно ли прийти снова и когда», и в фильтре очереди нужны все. В конце списка: id
  // заявки — её номер в нём, и вставка в середину сдвинула бы id уже залитых строк.
  {
    status: 'REJECTED',
    universityName: 'Прикаспийский технический институт',
    city: 'Актау',
    contactName: 'Нурлан Ахметов',
    contactRole: 'Методист',
    email: 'n.akhmetov@pti.example.kz',
    studentsEstimate: 3800,
    rejectionReason: 'DUPLICATE',
    reviewNote: 'Заявка этого вуза уже в работе — от проректора',
    daysAgo: 4,
  },
  {
    status: 'REJECTED',
    universityName: 'Университет',
    contactName: 'Алия',
    email: 'aliya.k@mail.example.kz',
    rejectionReason: 'INSUFFICIENT_INFO',
    reviewNote: 'Не указаны город и название вуза',
    daysAgo: 9,
  },
  {
    status: 'REJECTED',
    universityName: 'Восточный гуманитарный колледж',
    city: 'Усть-Каменогорск',
    contactName: 'Ольга Савченко',
    contactRole: 'Заместитель директора',
    email: 'o.savchenko@vgk.example.kz',
    studentsEstimate: 900,
    rejectionReason: 'NO_CAPACITY',
    reviewNote: 'Пилотные места на семестр заняты — вернуться в январе',
    daysAgo: 30,
  },
  {
    status: 'REJECTED',
    universityName: 'Академия дизайна «Форма»',
    city: 'Алматы',
    contactName: 'Тимур Есенов',
    email: 't.esenov@forma.example.kz',
    studentsEstimate: 450,
    rejectionReason: 'OTHER',
    reviewNote: 'Просили интеграцию с их LMS, которой нет в планах',
    daysAgo: 45,
  },
]

/**
 * Версия текста согласия. Дублирует `CONSENT_VERSION` из packages/shared-schemas —
 * сид на .mjs и типы оттуда не тянет. При смене текста согласия поправить в обоих местах.
 */
const CONSENT_VERSION = '2026-09-28'

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
// Действия и сущности — те, что пишет API (AuditService.record): фильтр журнала по действию
// и счётчики дашбордов (например, `complaint_resolved` у модератора) ищут именно их. Вход
// и выход — чаще остальных, как в жизни. Прежние USER_LOGIN/INVITE_CREATED API не пишет.
const AUDIT_ACTIONS = [
  ['login', null],
  ['login', null],
  ['login', null],
  ['logout', null],
  ['invite_created', 'Invite'],
  ['invite_revoked', 'Invite'],
  ['post_created', 'Post'],
  ['post_deleted', 'Post'],
  ['complaint_taken', 'Complaint'],
  ['complaint_resolved', 'Complaint'],
  ['user_warned', 'User'],
  ['attendance_marked', 'Attendance'],
  ['grades_saved', 'GradeColumn'],
  ['material_created', 'Material'],
  ['event_created', 'Event'],
  ['password_changed', 'User'],
]
// Приоритет жалобы — по категории цели (complaintPriorityFor в shared-schemas).
const PRIORITY_BY_TARGET = { USER: 'HIGH', MESSAGE: 'HIGH', POST: 'MEDIUM', STORY: 'MEDIUM', COMMENT: 'LOW' } // prettier-ignore
// Версии «Что нового» — из бандла веба (notes.json рядом с нотами, его же читает CI).
const RELEASE_NOTES_URL = new URL('../../../apps/web/src/entities/release/model/notes.json', import.meta.url) // prettier-ignore

const COMPLAINT_REASONS = [
  'Спам в комментариях',
  'Оскорбление в личных сообщениях',
  'Недостоверная информация в посте',
  'Реклама сторонних услуг',
]

export async function seedDemoExtras(prisma, writer, { random, platform = false }) {
  const uniId = DEMO_UNIVERSITY_ID

  // ── 0. Заявки вузов на тестирование ────────────────────────────────────────
  //
  // Стоит ДО всех проверок ниже, и это важно: остальные разделы шага выходят, если на
  // стенде нет демо-вуза или именованных dev-аккаунтов, а заявки к ним не относятся —
  // они платформенные. Ниже гарда они молча не создавались бы ровно на тех стендах,
  // где очередь и надо посмотреть.
  //
  // Без них очередь платформенного админа пуста на любом стенде, и экран, который
  // разбирают руками, никто ни разу не видит заполненным.
  const [platformAdmin] = await prisma.user.findMany({
    where: { role: 'PLATFORM_ADMIN' },
    select: { id: true },
    take: 1,
  })
  for (const [ri, req] of DEMO_REQUESTS.entries()) {
    const createdAt = random.daysFromNow(-req.daysAgo)
    const decided = req.status === 'APPROVED' || req.status === 'REJECTED'
    await writer.add('universityDemoRequest', {
      id: `seed-demo-request-${ri}`,
      universityName: req.universityName,
      city: req.city ?? null,
      country: 'KZ',
      studentsEstimate: req.studentsEstimate ?? null,
      contactName: req.contactName,
      contactRole: req.contactRole ?? null,
      email: req.email,
      phone: req.phone ?? null,
      comment: req.comment ?? null,
      status: req.status,
      // Подтверждённые заявки токена не хранят: он гасится при первом переходе.
      // У неподтверждённой он есть, но здесь это заведомо мёртвая строка — перейти
      // по ней всё равно не по чему, письма со стенда никто не открывал.
      emailVerificationHash: req.status === 'PENDING_EMAIL' ? `seed-dead-hash-${ri}` : null,
      consentAt: createdAt,
      consentVersion: CONSENT_VERSION,
      ip: `10.20.0.${ri + 1}`,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      reviewedAt: decided ? new Date(createdAt.getTime() + 2 * 86_400_000) : null,
      reviewedById: decided ? (platformAdmin?.id ?? null) : null,
      rejectionReason: req.rejectionReason ?? null,
      reviewNote: req.reviewNote ?? null,
      // Вуз одобренной заявки к демо-вузу не привязываем: он заведён отдельно и своей
      // структурой, а ссылка на чужой вуз в журнале — неправда, которую потом читают.
      universityId: null,
      createdAt,
      updatedAt: createdAt,
    })
  }
  await writer.flush()

  // ── 0б. Состояние платформы (мини-апп, «Управление платформой») ─────────────
  if (platform) await seedPlatformState(prisma, random)

  const dev = await prisma.user.findMany({
    where: { email: { in: DEV_EMAILS } },
    select: { id: true, email: true },
    // findMany без take запрещён (BACKEND_RULES §5.3) — даже когда выборка ограничена
    // списком адресов и больше семи строк вернуться не может.
    take: DEV_EMAILS.length,
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
  // Жалоба на комментарий — приоритет LOW: без неё нижняя ступень очереди пуста.
  const comments = await prisma.comment.findMany({
    where: { postId: { in: posts.map((p) => p.id) }, deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 3,
  })
  for (let ci = 0; ci < 10 && posts.length > 0; ci += 1) {
    const status = random.pickWeighted([
      ['PENDING', 40],
      ['REVIEWING', 20],
      ['RESOLVED', 30],
      ['DISMISSED', 10],
    ])
    const closed = status === 'RESOLVED' || status === 'DISMISSED'
    const onUser = ci % 3 === 0
    const onComment = !onUser && ci % 4 === 1 && comments.length > 0
    const targetType = onUser ? 'USER' : onComment ? 'COMMENT' : 'POST'
    await writer.add('complaint', {
      id: `seed-demo-cmp-${ci}`,
      reporterId: pool[ci % pool.length],
      targetType,
      targetId: onUser
        ? pool[(ci + 5) % pool.length]
        : onComment
          ? comments[ci % comments.length].id
          : posts[ci % posts.length].id,
      reason: random.pick(COMPLAINT_REASONS),
      status,
      priority: PRIORITY_BY_TARGET[targetType],
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
      action: AUDIT_ACTIONS[ai % AUDIT_ACTIONS.length][0],
      entity: AUDIT_ACTIONS[ai % AUDIT_ACTIONS.length][1],
      // id сущности у входа/выхода нет; у остальных — вуз как ближайшая известная сущность.
      entityId: AUDIT_ACTIONS[ai % AUDIT_ACTIONS.length][1] ? uniId : null,
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

  // ── 7. «Что нового» и настройки уведомлений демо-вуза ──────────────────────
  const demoUsers = await prisma.user.findMany({
    where: { universityId: uniId },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 1000,
  })
  await seedReleaseViews(
    writer,
    [...devIds],
    demoUsers.map((u) => u.id),
    random,
  )
  await seedNotificationSettings(
    writer,
    demoUsers.map((u) => u.id),
  )
  await writer.flush()
}

/**
 * Состояние платформы — одна строка `singleton`, рычаги мини-аппа. Создаётся, только если её
 * нет (upsert без update): на общей базе её уже настроил человек, и сид не вправе молча
 * включить техработы или заглушить уведомления команде.
 *
 * Значения безвредны для работы стенда, но заполняют каждый блок экрана: техработы и
 * баннер — уже прошедшие (окно в прошлом = выключено, но текст и тон видны в форме),
 * разделы все включены, оформление — по календарю, часы тишины 22→8, дайджест в 9 утра,
 * дежурства — по очереди из команды платформы. Погасить раздел или включить сезон сид не
 * может: это рычаг одного значения, и любое из них меняет стенд для всех.
 */
async function seedPlatformState(prisma, random) {
  const team = await prisma.user.findMany({
    where: { role: { in: ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR'] }, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 10,
  })
  // Очередь дежурств принимает только uuid (SetDutySchema) — а сидовые id бывают читаемыми.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const rotation = team.map((u) => u.id).filter((uid) => UUID.test(uid))
  const maintenanceFrom = random.daysFromNow(-3)
  const latest = readReleaseVersions()[0] ?? null
  await prisma.platformState.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      maintenanceFrom,
      maintenanceUntil: new Date(maintenanceFrom.getTime() + 40 * 60_000),
      maintenanceMessageRu: 'Обновляем платформу. Вернёмся через полчаса.',
      maintenanceMessageKk: 'Платформаны жаңартып жатырмыз. Жарты сағаттан кейін ораламыз.',
      maintenanceMessageEn: 'We are updating the platform. Back in half an hour.',
      bannerUntil: random.daysFromNow(-1),
      bannerTextRu: 'Вышла новая версия расписания — проверьте изменения.',
      bannerTextKk: 'Кестенің жаңа нұсқасы шықты — өзгерістерді тексеріңіз.',
      bannerTextEn: 'A new schedule version is out — check the changes.',
      bannerLevel: 'INFO',
      bannerRoles: ['STUDENT', 'STAROSTA'],
      bannerUniversityIds: [],
      disabledSections: [],
      announcedVersion: latest,
      seasonOff: false,
      seasonOverride: null,
      quietFrom: 22,
      quietTo: 8,
      mutedNotifications: ['digest'],
      dutyUserId: rotation[0] ?? null,
      dutyRotation: rotation,
      digestHour: 9,
      updatedById: team[0]?.id ?? null,
    },
  })
}

/** Версии нот «Что нового», новые сверху. Нет файла (сид вне монорепо) — пусто. */
function readReleaseVersions() {
  try {
    return JSON.parse(readFileSync(RELEASE_NOTES_URL, 'utf8')).map((n) => n.version)
  } catch {
    return []
  }
}

/**
 * Прочитанные «Что нового». Dev-аккаунты дочитали последнюю версию: окно не всплывает поверх
 * экранов, по которым ходят человек и e2e. Остальные — по кругу: последняя, одна из
 * прежних (окно покажет новую) или строки нет вовсе (ещё ничего не открывал).
 */
async function seedReleaseViews(writer, devIds, userIds, random) {
  const versions = readReleaseVersions()
  if (versions.length === 0) return
  const dev = new Set(devIds)
  for (const [ui, userId] of [...devIds, ...userIds.filter((u) => !dev.has(u))].entries()) {
    const kind = dev.has(userId) ? 0 : ui % 3
    if (kind === 2) continue
    await writer.add('releaseView', {
      userId,
      version: kind === 0 ? versions[0] : versions[1 + (ui % Math.max(1, versions.length - 1))] ?? versions[0], // prettier-ignore
      seenAt: random.randomDate(-30, -1),
    })
  }
}

/**
 * Настройки уведомлений демо-вуза — у генератора их заводит шаг 30, а демо-вуз жил на
 * умолчаниях. Каналы по кругу (email/push: оба, только один, ни одного — колокол IN_APP
 * работает всегда), и каждый тип хотя бы у кого-то выключен. SYSTEM выключить можно, но
 * сервис доставляет его принудительно — поэтому он выключен реже всех. Уже сохранённые
 * человеком настройки не трогаются: userId уникален, строка пропускается.
 */
async function seedNotificationSettings(writer, userIds) {
  const CHANNELS = [
    [true, false],
    [true, true],
    [false, true],
    [false, false],
  ]
  for (const [ui, userId] of userIds.entries()) {
    const [emailEnabled, pushEnabled] = CHANNELS[ui % CHANNELS.length]
    await writer.add('notificationSettings', {
      id: `seed-demo-ns-${userId}`,
      userId,
      emailEnabled,
      pushEnabled,
      scheduleChangeEnabled: ui % 7 !== 1,
      appUpdateEnabled: ui % 7 !== 2,
      messageEnabled: ui % 7 !== 3,
      postEnabled: ui % 7 !== 4,
      eventEnabled: ui % 7 !== 5,
      systemEnabled: ui % 23 !== 6,
    })
  }
}
