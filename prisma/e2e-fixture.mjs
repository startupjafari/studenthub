// Минимальные данные для e2e-прогона. НЕ сид: демо-наполнение из prisma/seed/ живёт
// своей жизнью и тестам не нужно — им нужен ровно тот минимум,
// без которого они не могут даже войти, — аккаунты по одному на роль, вуз с факультетом
// и группой, к которым эти аккаунты привязаны, инвайт для сценария регистрации и одна
// запись КАТО, чтобы город вуза было во что резолвить.
//
// Всё остальное — расписание, оценки, документы, чаты, посты — тесты создают сами или
// проверяют на пустых состояниях: пустой экран это тоже состояние, и у него тоже есть
// вёрстка.
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

const prisma = new PrismaClient()

const PASSWORD = process.env.E2E_PASSWORD ?? 'Admin1234!'
const UNIVERSITY_ID = 'seed-university-001'
const FACULTY_ID = 'seed-faculty-001'
const GROUP_ID = 'seed-group-001'
const INVITE_TOKEN = 'seed-invite-university-admin-token'
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

await prisma.$disconnect()
console.log(`e2e-fixture: ${USERS.length + 1} аккаунт(ов), вуз, факультет, группа, инвайт готовы`)
