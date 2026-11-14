// Охрана и библиотекарь для вуза, засеянного генератором (prisma/seed/): генератор этих
// ролей не заводит, а демо-вуз с security@/librarian@studenthub.app на боевой базе не
// заливается. Нужны, чтобы проверять экраны охраны и библиотеки на тестовом стенде.
//
// Заводит security.0@<вуз>.edu.kz и librarian.0@<вуз>.edu.kz — по тем же правилам, что
// именные аккаунты основного сида: роль, привязка к вузу, закрытый профиль. Пароль —
// SEED_STAFF_PASSWORD (обязателен); повторный запуск приводит аккаунты к известному
// состоянию и сбрасывает пароль на заданный. Включает библиотеку вуза и наполняет её тем
// же шагом, что генератор (seed/steps/45-library.mjs), — у библиотекаря экраны не пустые.
//
// Вуз — SEED_STAFF_UNIVERSITY (id), иначе вуз admin@u001.edu.kz. В удалённую базу —
// только с SEED_ALLOW_REMOTE=1, как остальной сид. Запуск на Railway — workflow
// prodDbSeed, режим staff.
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { loadEnv } from './seed/lib/env.mjs'
import { makeRandom, SEED_BASE } from './seed/lib/rng.mjs'
import { isLocalDatabase } from './seed/config.mjs'
import { seedLibrary } from './seed/steps/45-library.mjs'

const env = loadEnv()
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL

if (!isLocalDatabase(process.env.DATABASE_URL) && process.env.SEED_ALLOW_REMOTE !== '1') {
  console.error('seed-staff: база не локальная — задайте SEED_ALLOW_REMOTE=1, если это осознанно')
  process.exit(1)
}
const password = process.env.SEED_STAFF_PASSWORD
if (!password || password.length < 8) {
  console.error('seed-staff: задайте SEED_STAFF_PASSWORD (не короче 8 символов)')
  process.exit(1)
}

const prisma = new PrismaClient()

const STAFF = [
  {
    role: 'SECURITY_GUARD',
    local: 'security.0',
    firstName: 'Ерлан',
    lastName: 'Жумабаев',
    middleName: 'Кайратович',
    gender: 'MALE',
    position: 'Сотрудник охраны',
    jobTitle: 'Охрана',
    responsibilities: 'Пропускной режим главного корпуса, проверка студенческих билетов.',
  },
  {
    role: 'LIBRARIAN',
    local: 'librarian.0',
    firstName: 'Гульнара',
    lastName: 'Сапарова',
    middleName: 'Ермековна',
    gender: 'FEMALE',
    position: 'Библиотекарь',
    jobTitle: 'Библиотека',
    responsibilities: 'Выдача и приём книг, учёт фонда, работа с должниками.',
  },
]

async function resolveUniversity() {
  const explicit = process.env.SEED_STAFF_UNIVERSITY
  const admin = await prisma.user.findFirst({
    where: explicit
      ? { universityId: explicit, role: 'UNIVERSITY_ADMIN', deletedAt: null }
      : { email: 'admin@u001.edu.kz' },
    select: { universityId: true, email: true },
  })
  if (!admin?.universityId) return null
  // Домен почты — как у админа вуза: генератор строит все адреса вуза от одного префикса.
  return { id: admin.universityId, domain: admin.email.split('@')[1] }
}

async function main() {
  const university = await resolveUniversity()
  if (!university) {
    console.error('seed-staff: вуз не найден — задайте SEED_STAFF_UNIVERSITY (id вуза с админом)')
    process.exitCode = 1
    return
  }
  const passwordHash = await bcrypt.hash(password, 12)
  const created = []
  for (const staff of STAFF) {
    const email = `${staff.local}@${university.domain}`
    const profile = {
      firstName: staff.firstName,
      lastName: staff.lastName,
      middleName: staff.middleName,
      gender: staff.gender,
      position: staff.position,
      jobTitle: staff.jobTitle,
      responsibilities: staff.responsibilities,
      // Профиль охраны и библиотекаря закрыт по умолчанию — как у роли на проде.
      profileVisibility: 'PRIVATE',
    }
    // Только id в ответе: база стенда может отставать от ветки по миграциям, и полная
    // запись тянула бы колонки, которых в ней ещё нет.
    await prisma.user.upsert({
      where: { email },
      update: {
        ...profile,
        passwordHash,
        role: staff.role,
        universityId: university.id,
        isBlocked: false,
        deletedAt: null,
      },
      create: { email, passwordHash, role: staff.role, universityId: university.id, ...profile },
      select: { id: true },
    })
    created.push(`${staff.role}: ${email}`)
  }

  let library = 'библиотека: пропущено'
  try {
    const result = await seedLibrary(prisma, {
      universityId: university.id,
      random: makeRandom(SEED_BASE + 45),
    })
    library = result.skipped
      ? `библиотека: включена, наполнение пропущено (${result.reason ?? 'уже заполнено'})`
      : `библиотека: книг ${result.books}, экземпляров ${result.copies}, выдач ${result.loans}`
  } catch (error) {
    library = `библиотека: не наполнена (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`
  }

  console.log(`seed-staff: вуз ${university.id}`)
  for (const line of created) console.log(`  ${line}`)
  console.log(`  ${library}`)
  console.log('  пароль — SEED_STAFF_PASSWORD')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
