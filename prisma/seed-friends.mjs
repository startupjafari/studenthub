// Демо-друзья и заявки для dev-аккаунтов: у каждой роли появляется блок «Друзья»
// и «Заявки в друзья» в правой колонке ленты.
//
// Связи ставим прямо в БД, минуя FriendsService: уведомлений о заявках при этом не
// создаётся — колокол их не покажет, а панель у ленты покажет. Для демо этого хватает,
// и сид не зависит от очереди (Redis/BullMQ), которая в чистом окружении может не подняться.
//
// Запуск: node prisma/seed-friends.mjs  (или pnpm db:seed:friends)
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Детерминированный генератор: повторный прогон раскладывает те же пары.
function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
const DAY = 86_400_000

// Кому раздаём связи. Ключ идёт в id связи — чтобы повторный прогон обновлял свои строки.
const DEV_ACCOUNTS = [
  ['student', 'student@studenthub.app'],
  ['starosta', 'starosta@studenthub.app'],
  ['teacher', 'teacher@studenthub.app'],
  ['dean', 'dean@studenthub.app'],
  ['uniadmin', 'university-admin@studenthub.app'],
  ['unimod', 'university-moderator@studenthub.app'],
  ['platmod', 'platform-moderator@studenthub.app'],
]

// Сколько связей на аккаунт: друзей хватает на две строки сетки 3×2 с запасом
// («показать всех» должно быть чем наполнить), входящих — больше превью в 3 карточки.
const FRIENDS = 8
const INCOMING = 4
const OUTGOING = 2

// Тасовка Фишера — Йетса на детерминированном rng.
function shuffle(arr, rng) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Ставит связь, не задевая настоящие.
 *
 * Между парой возможна ровно одна строка (@@unique + проверка обеих сторон в сервисе),
 * поэтому если связь между этими двумя уже есть и она не наша — выходим. Иначе upsert
 * по фиксированному id: повторный прогон переписывает свою же строку.
 */
async function link(id, requesterId, addresseeId, status, createdAt, respondedAt) {
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId, addresseeId },
        { requesterId: addresseeId, addresseeId: requesterId },
      ],
    },
    select: { id: true },
  })
  if (existing && existing.id !== id) return false
  const data = { requesterId, addresseeId, status, createdAt, respondedAt }
  await prisma.friendship.upsert({ where: { id }, update: data, create: { id, ...data } })
  return true
}

async function main() {
  const uni = await prisma.university.findFirst({ select: { id: true } })
  if (!uni) throw new Error('Нет вуза — сначала прогоните основной сид (pnpm db:seed)')

  const devEmails = DEV_ACCOUNTS.map(([, email]) => email)
  const devUsers = await prisma.user.findMany({
    where: { email: { in: devEmails } },
    select: { id: true, email: true },
  })
  const byEmail = new Map(devUsers.map((u) => [u.email, u.id]))
  if (byEmail.size === 0) throw new Error('Нет dev-аккаунтов — прогоните основной сид')

  // Кандидаты в друзья — сгенерированные студенты и преподаватели вуза, кроме dev-аккаунтов.
  // Порядок по id: выборка стабильна между прогонами, значит стабильна и тасовка.
  const pool = await prisma.user.findMany({
    where: {
      universityId: uni.id,
      deletedAt: null,
      role: { in: ['STUDENT', 'STAROSTA', 'TEACHER'] },
      email: { notIn: devEmails },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 400,
  })
  const need = FRIENDS + INCOMING + OUTGOING
  if (pool.length < need) {
    throw new Error(`Мало пользователей для связей: ${pool.length} < ${need}`)
  }

  let created = 0
  let skipped = 0

  for (const [key, email] of DEV_ACCOUNTS) {
    const me = byEmail.get(email)
    if (!me) {
      console.warn(`Пропущен ${email}: аккаунта нет в базе`)
      continue
    }
    // Своя тасовка на каждый аккаунт: у ролей разные друзья, а не один и тот же список.
    const rng = makeRng(20260828 + key.length * 7919)
    const picked = shuffle(pool, rng).slice(0, need)

    let i = 0
    for (let n = 0; n < FRIENDS; n++, i++) {
      const other = picked[i].id
      // Кто кого добавил — чередуем: иначе dev-аккаунт всегда «отправитель», и в чужом
      // профиле кнопка выглядела бы одинаково у всех связей.
      const iAsked = n % 2 === 0
      const since = new Date(Date.now() - (n * 9 + 3) * DAY)
      const ok = await link(
        `seed-friend-${key}-a${String(n + 1).padStart(2, '0')}`,
        iAsked ? me : other,
        iAsked ? other : me,
        'ACCEPTED',
        new Date(since.getTime() - DAY),
        since,
      )
      if (ok) created++
      else skipped++
    }

    for (let n = 0; n < INCOMING; n++, i++) {
      const ok = await link(
        `seed-friend-${key}-i${String(n + 1).padStart(2, '0')}`,
        picked[i].id,
        me,
        'PENDING',
        new Date(Date.now() - (n * 6 + 1) * 3600_000),
        null,
      )
      if (ok) created++
      else skipped++
    }

    for (let n = 0; n < OUTGOING; n++, i++) {
      const ok = await link(
        `seed-friend-${key}-o${String(n + 1).padStart(2, '0')}`,
        me,
        picked[i].id,
        'PENDING',
        new Date(Date.now() - (n * 11 + 2) * 3600_000),
        null,
      )
      if (ok) created++
      else skipped++
    }
  }

  const total = await prisma.friendship.count({ where: { id: { startsWith: 'seed-friend-' } } })
  const pending = await prisma.friendship.count({
    where: { id: { startsWith: 'seed-friend-' }, status: 'PENDING' },
  })
  console.log(
    `Друзья: связей ${total} (принятых ${total - pending}, заявок ${pending}) на ${byEmail.size} аккаунтов` +
      (skipped ? `; пропущено из-за существующих связей: ${skipped}` : ''),
  )
  if (created === 0 && skipped === 0) console.warn('Ничего не создано — проверьте dev-аккаунты')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
