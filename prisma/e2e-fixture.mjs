// Минимальные данные для e2e-прогона. НЕ сид: демо-наполнение из prisma/seed/ живёт
// своей жизнью и тестам не нужно — им нужен ровно тот минимум,
// без которого они не могут даже войти, — аккаунты по одному на роль, вуз с факультетом
// и группой, к которым эти аккаунты привязаны, инвайт для сценария регистрации и одна
// запись КАТО, чтобы город вуза было во что резолвить.
//
// Всё остальное — оценки, документы, посты — тесты создают сами или проверяют на пустых
// состояниях: пустой экран это тоже состояние, и у него тоже есть вёрстка.
//
// Два исключения, и оба вынужденные.
//
// КАТАЛОГ УСЛУГ — справочник платформы, а не демо-данные: глобальные шаблоны услуг видны
// всем вузам, и заявка студента ссылается именно на них. Без него сценарий заявок не
// находит ни одной услуги и падает на пустом каталоге, хотя проверяет совсем другое.
//
// РАСПИСАНИЕ С ОДНОЙ ПАРОЙ — потому что чат предмета создаётся ЛЕНИВО, по парам активного
// расписания группы, и проверить отправку сообщения в него можно только если пара есть.
// Сам тест создать её не может: он ходит под студентом, а расписание ведёт декан.
//
// ОДИН ПОСТ — сценарий ленты проверяет, что карточка публикации отрисовалась. Написать
// его сам он тоже не может: композер есть у сотрудников, а лента смотрится из-под
// студента. Пустая лента — тоже состояние, но проверяет его другой тест.
//
// Запускается из apps/web/e2e/prepare-db.mjs на DATABASE_URL_TEST, после `db push
// --force-reset`. На непустой или нетестовой базе не запускается — проверки в самом
// prepare-db.mjs.
//
//   node prisma/e2e-fixture.mjs
//
// Пароль у всех аккаунтов один: E2E_PASSWORD или `Admin1234!` (его же ждёт
// apps/web/e2e/support/sign-in.ts).

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { seedServiceCatalog } from './seed/steps/05-service-catalog.mjs'

const prisma = new PrismaClient()

const PASSWORD = process.env.E2E_PASSWORD ?? 'Admin1234!'
const UNIVERSITY_ID = 'seed-university-001'
const FACULTY_ID = 'seed-faculty-001'
const GROUP_ID = 'seed-group-001'
const INVITE_TOKEN = 'seed-invite-university-admin-token'
const SCHEDULE_ID = 'seed-schedule-001'
const PAIR_ID = 'seed-pair-001'
const POST_ID = 'seed-post-001'
// Предмет пары. Его же ищет apps/web/e2e/chat.e2e.ts — имя чата предмета берётся отсюда.
const SUBJECT = 'Машинное обучение'
// г. Алматы. `University.city` хранит код КАТО, а не название.
const ALMATY = '750000000'

// Один хэш на всех: bcrypt с cost=12 стоит ~0.3 с, а аккаунтов восемь — на прогоне это
// заметно, и никакой пользы от разных хэшей у одного и того же пароля нет.
const passwordHash = await bcrypt.hash(PASSWORD, 12)

// 2FA у тестовых аккаунтов выключена: иначе вход требует кода, которого тесту взять негде.
const NO_2FA = { twoFactorEnabled: false, twoFactorSecret: null }

await prisma.katoUnit.upsert({
  where: { code: ALMATY },
  update: {},
  create: {
    code: ALMATY,
    kind: 'REGION',
    nameRu: 'Алматы',
    nameKk: 'Алматы',
    regionCode: ALMATY,
  },
})

const admin = await prisma.user.upsert({
  where: { email: 'admin@studenthub.app' },
  update: NO_2FA,
  create: {
    email: 'admin@studenthub.app',
    passwordHash,
    firstName: 'Платформенный',
    lastName: 'Администратор',
    role: 'PLATFORM_ADMIN',
    ...NO_2FA,
  },
})

const university = await prisma.university.upsert({
  where: { id: UNIVERSITY_ID },
  update: {},
  create: {
    id: UNIVERSITY_ID,
    name: 'Университет «Алатау»',
    shortName: 'АУ',
    status: 'ACTIVE',
    country: 'Казахстан',
    city: ALMATY,
  },
})

const faculty = await prisma.faculty.upsert({
  where: { id: FACULTY_ID },
  update: {},
  create: {
    id: FACULTY_ID,
    name: 'Факультет информационных технологий',
    universityId: university.id,
  },
})

await prisma.group.upsert({
  where: { id: GROUP_ID },
  update: {},
  create: { id: GROUP_ID, name: 'ИТ-23-1', year: 2023, facultyId: faculty.id },
})

// Инвайт для сценария регистрации (apps/web/e2e/register.e2e.ts).
await prisma.invite.upsert({
  where: { token: INVITE_TOKEN },
  update: { status: 'PENDING', expiresAt: new Date(Date.now() + 30 * 86_400_000) },
  create: {
    token: INVITE_TOKEN,
    role: 'UNIVERSITY_ADMIN',
    email: 'university-admin@demo.studenthub.app',
    universityId: UNIVERSITY_ID,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    createdById: admin.id,
  },
})

// По одному аккаунту на роль: по ним ходит и UI-аудит, которому нужна каждая ролевая зона.
const uni = { universityId: UNIVERSITY_ID }
const fac = { ...uni, facultyId: FACULTY_ID }
const grp = { ...fac, groupId: GROUP_ID }
const USERS = [
  ['PLATFORM_MODERATOR', 'platform-moderator@studenthub.app', 'Марат', 'Сулейменов', {}],
  ['UNIVERSITY_ADMIN', 'university-admin@studenthub.app', 'Айгуль', 'Нурланова', uni],
  ['UNIVERSITY_MODERATOR', 'university-moderator@studenthub.app', 'Тимур', 'Байжанов', uni],
  ['DEAN', 'dean@studenthub.app', 'Дамир', 'Ахметов', fac],
  ['TEACHER', 'teacher@studenthub.app', 'Елена', 'Иванова', fac],
  ['STAROSTA', 'starosta@studenthub.app', 'Аружан', 'Серикова', grp],
  ['STUDENT', 'student@studenthub.app', 'Нурлан', 'Оспанов', grp],
]

for (const [role, email, firstName, lastName, scope] of USERS) {
  await prisma.user.upsert({
    where: { email },
    update: NO_2FA,
    create: { email, passwordHash, firstName, lastName, role, ...scope, ...NO_2FA },
  })
}

// Каталог услуг: категории и глобальные шаблоны. Шаг идемпотентный (фиксированные id +
// upsert), поэтому повторный прогон фикстуры ничего не ломает.
await seedServiceCatalog(prisma)

// Расписание группы с одной парой — ради чата предмета (см. шапку файла).
// Преподаватель проставляется: в чат предмета он входит по своим парам, и без него
// проверять чат предмета можно было бы только от студента.
const teacher = await prisma.user.findUnique({ where: { email: 'teacher@studenthub.app' } })
const schedule = await prisma.schedule.upsert({
  where: { id: SCHEDULE_ID },
  update: { isActive: true },
  create: { id: SCHEDULE_ID, groupId: GROUP_ID, name: 'Осенний семестр', isActive: true },
})
await prisma.pair.upsert({
  where: { id: PAIR_ID },
  update: { subject: SUBJECT, teacherId: teacher?.id ?? null },
  create: {
    id: PAIR_ID,
    scheduleId: schedule.id,
    groupId: GROUP_ID,
    subject: SUBJECT,
    teacherId: teacher?.id ?? null,
    // Понедельник, первая пара. Конкретные день и время тестам безразличны — важно лишь,
    // что пара есть и расписание активно.
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:30',
  },
})

// Пост в ленте: автор — декан, аудитория «весь вуз», чтобы его видел любой аккаунт вуза.
const dean = await prisma.user.findUnique({ where: { email: 'dean@studenthub.app' } })
if (dean) {
  await prisma.post.upsert({
    where: { id: POST_ID },
    update: {},
    create: {
      id: POST_ID,
      authorId: dean.id,
      audience: 'UNIVERSITY',
      universityId: UNIVERSITY_ID,
      title: 'Объявление деканата',
      content: 'Публикация для e2e: лента не должна быть пустой.',
    },
  })
}

await prisma.$disconnect()
console.log(
  `e2e-fixture: ${USERS.length + 1} аккаунт(ов), вуз, факультет, группа, инвайт, каталог услуг, пара «${SUBJECT}», пост готовы`,
)
