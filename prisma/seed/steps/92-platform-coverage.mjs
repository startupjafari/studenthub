// Шаг «платформа: остальное» — то, что не принадлежит ни одному вузу и чего не создают
// остальные шаги: вузы в статусах PENDING и BLOCKED, инвайты платформенного уровня
// (модератор платформы, админ нового вуза) и события платформы для всех (аудитория ALL).
//
// Без них у админа платформы пустые фильтры «Ожидает запуска» и «Заблокирован» в списке
// вузов, вкладка инвайтов показывает только приглашения вузов, а в ленте событий нет
// ни одного общего события — проверить эти экраны на стенде было нечем.
//
// Только локальный стенд с демо-вузом (как строка состояния платформы в 90-demo-extras):
// на общей базе (SEED_ALLOW_REMOTE) лишние вузы и приглашения выглядели бы настоящими.
//
// Вузы — пустые: заблокированный закрывает вход своим людям (UniversityAccessService), и
// населённый вуз в этом статусе отнял бы у стенда его пользователей. Идемпотентно:
// фиксированные id, createMany skipDuplicates.

import { createHash, randomUUID } from 'node:crypto'

const DAY_MS = 24 * 60 * 60 * 1000
const PENDING_UNI = 'seed-platform-uni-pending'
const BLOCKED_UNI = 'seed-platform-uni-blocked'

// Хэш случайного токена, как хранит invites.service: по живому (PENDING) инвайту из
// репозитория нельзя зарегистрироваться. Использованным и истёкшим токен не нужен.
const liveToken = () => createHash('sha256').update(randomUUID()).digest('hex')

export async function seedPlatformCoverage(prisma) {
  const admin = await prisma.user.findFirst({
    where: { role: 'PLATFORM_ADMIN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) return { skipped: true }
  const moderator = await prisma.user.findFirst({
    where: { role: 'PLATFORM_MODERATOR' },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  // Город — код КАТО (University.city), берём у любого заведённого вуза.
  const anyUni = await prisma.university.findFirst({
    where: { city: { not: null } },
    select: { city: true },
  })
  const now = Date.now()

  await prisma.university.createMany({
    data: [
      {
        id: PENDING_UNI,
        name: 'Высшая школа цифровых технологий',
        shortName: 'ВШЦТ',
        status: 'PENDING',
        country: 'KZ',
        city: anyUni?.city ?? null,
        description: 'Вуз заведён платформой и ждёт, пока его админ примет приглашение.',
        contactEmail: 'rector@hsdt.example.kz',
        createdAt: new Date(now - 2 * DAY_MS),
      },
      {
        id: BLOCKED_UNI,
        name: 'Колледж прикладных искусств',
        shortName: 'КПИ',
        status: 'BLOCKED',
        country: 'KZ',
        city: anyUni?.city ?? null,
        description: 'Доступ закрыт платформой: договор не продлён.',
        contactEmail: 'office@cpa.example.kz',
        createdAt: new Date(now - 200 * DAY_MS),
      },
    ],
    skipDuplicates: true,
  })

  // Иерархия (invite-hierarchy.ts): модератора платформы и админа вуза приглашает только
  // админ платформы. Все статусы — чтобы фильтр вкладки был непустым в каждом положении.
  const invites = [
    {
      id: 'seed-platform-inv-uadmin-pending',
      token: liveToken(),
      role: 'UNIVERSITY_ADMIN',
      email: 'rector@hsdt.example.kz',
      universityId: PENDING_UNI,
      status: 'PENDING',
      expiresAt: new Date(now + DAY_MS),
    },
    {
      id: 'seed-platform-inv-uadmin-revoked',
      token: 'seed-platform-inv-uadmin-revoked',
      role: 'UNIVERSITY_ADMIN',
      email: 'office@cpa.example.kz',
      universityId: BLOCKED_UNI,
      status: 'REVOKED',
      expiresAt: new Date(now - 150 * DAY_MS),
    },
    {
      id: 'seed-platform-inv-pmod-pending',
      token: liveToken(),
      role: 'PLATFORM_MODERATOR',
      email: 'new.moderator@studenthub.app',
      status: 'PENDING',
      expiresAt: new Date(now + DAY_MS),
    },
    {
      id: 'seed-platform-inv-pmod-expired',
      token: 'seed-platform-inv-pmod-expired',
      role: 'PLATFORM_MODERATOR',
      email: 'late.moderator@studenthub.app',
      status: 'EXPIRED',
      expiresAt: new Date(now - 10 * DAY_MS),
    },
    // Использованный — тем модератором, что уже есть: регистрация берёт роль из инвайта.
    ...(moderator
      ? [
          {
            id: 'seed-platform-inv-pmod-used',
            token: 'seed-platform-inv-pmod-used',
            role: 'PLATFORM_MODERATOR',
            status: 'USED',
            expiresAt: moderator.createdAt,
            usedById: moderator.id,
            usedAt: moderator.createdAt,
          },
        ]
      : []),
  ]
  await prisma.invite.createMany({
    data: invites.map((invite) => ({ createdById: admin.id, ...invite })),
    skipDuplicates: true,
  })

  // События платформы (ALL — единственная аудитория админа платформы, events.service):
  // одно онлайн впереди, одно прошедшее очное. Участники — из разных вузов.
  const events = [
    {
      id: 'seed-platform-ev-online',
      title: 'Вебинар StudentHub: что нового в семестре',
      description:
        'Расскажем о новых разделах платформы и ответим на вопросы студентов и преподавателей.',
      isOnline: true,
      meetingProvider: 'ZOOM',
      meetingUrl: 'https://us02web.zoom.us/j/81234567890',
      meetingPasscode: '271828',
      startsAt: new Date(now + 5 * DAY_MS),
      endsAt: new Date(now + 5 * DAY_MS + 90 * 60 * 1000),
    },
    {
      id: 'seed-platform-ev-offline',
      title: 'Слёт студенческих активов',
      description: 'Встреча старост и активистов вузов платформы: обмен опытом и награждение.',
      location: 'Астана, Дворец школьников, конференц-зал',
      isOnline: false,
      startsAt: new Date(now - 12 * DAY_MS),
      endsAt: new Date(now - 12 * DAY_MS + 4 * 60 * 60 * 1000),
    },
  ]
  await prisma.event.createMany({
    data: events.map((event) => ({
      organizerId: admin.id,
      audience: 'ALL',
      createdAt: new Date(now - 20 * DAY_MS),
      ...event,
    })),
    skipDuplicates: true,
  })
  const participants = await prisma.user.findMany({
    where: { role: { in: ['STUDENT', 'STAROSTA', 'TEACHER'] }, deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 40,
  })
  await prisma.eventParticipant.createMany({
    data: events.flatMap((event, e) =>
      participants
        .filter((_, i) => i % 2 === e)
        .map((user) => ({
          id: `${event.id}-p-${user.id}`,
          eventId: event.id,
          userId: user.id,
          createdAt: new Date(now - 10 * DAY_MS),
        })),
    ),
    skipDuplicates: true,
  })

  return {
    skipped: false,
    universities: 2,
    invites: invites.length,
    events: events.length,
  }
}
