// Демо-данные для сервиса заявок (docs/PROJECT.md §16): очередь у декана перестаёт быть
// пустой, и видно, как экран ведёт себя со всеми статусами, SLA и просрочкой.
//
// Идемпотентен: id заявок детерминированные (seed-app-NNN), повторный прогон переписывает
// те же строки, а не плодит новые. Данные воспроизводимы — PRNG с фиксированным зерном.
//
// Запуск: pnpm db:seed:apps
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const COUNT = 48
const HOUR = 3_600_000

// Детерминированный PRNG (mulberry32) — как в prisma/seed.mjs.
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
const rng = makeRng(20260827)
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))

/**
 * Раскладка очереди. Доли подобраны так, чтобы каждая вкладка фильтра была непустой,
 * а «Новые» и «В работе» преобладали — так выглядит реальная очередь.
 */
const MIX = [
  ['SUBMITTED', 12],
  ['IN_REVIEW', 9],
  ['IN_PREPARATION', 7],
  ['NEEDS_CORRECTION', 5],
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

function statusPlan() {
  const plan = []
  for (const [status, n] of MIX) for (let i = 0; i < n; i++) plan.push(status)
  // Хвост добираем «новыми» — их в очереди всегда больше всего.
  while (plan.length < COUNT) plan.push('SUBMITTED')
  return plan.slice(0, COUNT)
}

async function main() {
  const [services, students, staff] = await Promise.all([
    prisma.applicationService.findMany({
      select: { id: true, code: true, slaHours: true, deliveryModes: true, requiresPickup: true },
    }),
    prisma.user.findMany({
      where: { role: { in: ['STUDENT', 'STAROSTA'] }, facultyId: { not: null }, deletedAt: null },
      select: { id: true, universityId: true, facultyId: true },
      take: 400,
    }),
    prisma.user.findMany({
      where: { role: { in: ['DEAN', 'UNIVERSITY_ADMIN'] }, deletedAt: null },
      select: { id: true },
    }),
  ])

  if (services.length === 0 || students.length === 0) {
    throw new Error('Нет услуг или студентов с факультетом — сначала прогоните pnpm db:seed')
  }

  const now = Date.now()
  const plan = statusPlan()
  let created = 0
  let overdue = 0

  for (const [i, status] of plan.entries()) {
    const id = `seed-app-${String(i + 1).padStart(3, '0')}`
    const student = pick(students)
    const service = pick(services)

    // Срок = подача + SLA услуги, а SLA у справки всего 8 часов. Поэтому дату подачи
    // выбираем ВНУТРИ окна SLA — иначе просроченной оказывалась бы почти вся очередь.
    // Просрочку делаем явно и дозированно, чтобы вкладка «Просрочено» была не пустой,
    // но не преобладала.
    const isOverdue = ['SUBMITTED', 'IN_REVIEW', 'IN_PREPARATION'].includes(status) && rng() < 0.2
    const ageHours = isOverdue
      ? service.slaHours + randInt(2, 72)
      : randInt(1, Math.max(2, Math.floor(service.slaHours * 0.8)))
    const submittedAt = new Date(now - ageHours * HOUR)
    const dueAt = new Date(submittedAt.getTime() + service.slaHours * HOUR)
    if (isOverdue) overdue++

    const inWork = status !== 'SUBMITTED'
    const done = ['READY_FOR_PICKUP', 'ISSUED'].includes(status)
    const deliveryType = service.deliveryModes.includes('ELECTRONIC') ? 'ELECTRONIC' : 'PAPER'

    const data = {
      // Номер как в §13: SH-2026-001842. Уникален, поэтому строится из индекса.
      number: `SH-2026-${String(i + 1).padStart(6, '0')}`,
      studentId: student.id,
      universityId: student.universityId,
      facultyId: student.facultyId,
      serviceId: service.id,
      status,
      deliveryType,
      formData: { period: '2025-2026', reason: 'Демо-данные для тестирования очереди' },
      assignedToId: inWork && staff.length > 0 ? pick(staff).id : null,
      assignedAt: inWork ? new Date(submittedAt.getTime() + 2 * HOUR) : null,
      submittedAt,
      startedAt: inWork ? new Date(submittedAt.getTime() + 2 * HOUR) : null,
      dueAt,
      readyAt: done ? new Date(now - randInt(1, 48) * HOUR) : null,
      issuedAt: status === 'ISSUED' ? new Date(now - randInt(1, 24) * HOUR) : null,
      cancelledAt: status === 'CANCELLED' ? new Date(now - randInt(1, 96) * HOUR) : null,
      rejectionReason:
        status === 'REJECTED'
          ? pick(REJECTIONS)
          : status === 'NEEDS_CORRECTION'
            ? pick(CORRECTIONS)
            : null,
      pickupLocation: service.requiresPickup && done ? 'Деканат, кабинет 203' : null,
      pickupCode: status === 'READY_FOR_PICKUP' ? `PK-${String(1000 + i)}` : null,
    }

    await prisma.application.upsert({ where: { id }, update: data, create: { id, ...data } })

    // Журнал: заявка без событий выглядит в карточке как «ничего не происходило».
    // Пересоздаём целиком — иначе повторный прогон дублировал бы записи.
    await prisma.applicationEvent.deleteMany({ where: { applicationId: id } })
    const events = [
      { action: 'SUBMITTED', toStatus: 'SUBMITTED', createdAt: submittedAt, actorId: student.id },
    ]
    if (inWork) {
      events.push({
        action: 'STATUS_CHANGED',
        fromStatus: 'SUBMITTED',
        toStatus: status,
        createdAt: new Date(submittedAt.getTime() + 3 * HOUR),
        actorId: data.assignedToId,
        comment: data.rejectionReason,
      })
    }
    await prisma.applicationEvent.createMany({
      data: events.map((e) => ({ applicationId: id, ...e })),
    })
    created++
  }

  const byStatus = await prisma.application.groupBy({ by: ['status'], _count: { id: true } })
  console.log(`Заявки: записано ${created} (из них просроченных ${overdue})`)
  for (const row of byStatus.sort((a, b) => b._count.id - a._count.id)) {
    console.log(`  ${row.status.padEnd(18)} ${row._count.id}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
