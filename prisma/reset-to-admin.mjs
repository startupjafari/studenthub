// Полный сброс БД: все таблицы пустые, остаётся один PLATFORM_ADMIN.
//
// Зачем отдельно от seed: seed наливает демо-данные, а здесь нужно обратное — чистый
// стенд перед реальным наполнением (вузы, инвайты, живые пользователи). Схема и журнал
// миграций не трогаются: TRUNCATE, а не `migrate reset`, поэтому применять миграции
// заново не нужно и откатов версий не происходит.
//
// Запуск:
//   RESET_CONFIRM=RESET pnpm db:reset:admin                    # локальная БД
//   RESET_CONFIRM=RESET RESET_ALLOW_REMOTE=1 pnpm db:reset:admin  # удалённая (прод)
//
// Переменные:
//   RESET_CONFIRM         обязательно строка RESET — защита от случайного запуска
//   RESET_ALLOW_REMOTE=1  разрешить работу с нелокальной БД (иначе отказ)
//   RESET_ADMIN_EMAIL     e-mail админа (по умолчанию admin@studenthub.app)
//   RESET_ADMIN_PASSWORD  пароль; если не задан — генерируется и печатается в вывод
import { randomInt } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { isLocalDatabase } from './seed/config.mjs'
import { loadEnv } from './seed/lib/env.mjs'

// DATABASE_URL живёт в apps/api/.env, а простой `node` его не читает: .env подхватывает
// только Prisma CLI через prisma.config.ts (та же причина, что в prisma/seed-test.mjs).
// Уже заданное окружение приоритетнее — на CI переменные приходят снаружи.
const env = loadEnv()
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL

const DEFAULT_EMAIL = 'admin@studenthub.app'
// Журнал миграций переживает очистку: схема остаётся применённой, db:deploy не нужен.
const KEEP_TABLES = ['_prisma_migrations']

// Пароль под требования PasswordSchema (packages/shared-schemas/src/auth.ts):
// ≥ 8 символов, буква, цифра, спецсимвол. Похожие глифы (O/0, l/1) исключены —
// пароль диктуют голосом и переносят руками.
function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const specials = '!@#$%^&*-_=+'
  const alphabet = letters + digits + specials
  const chars = [
    letters[randomInt(letters.length)],
    digits[randomInt(digits.length)],
    specials[randomInt(specials.length)],
  ]
  while (chars.length < 20) chars.push(alphabet[randomInt(alphabet.length)])
  // Перемешиваем, чтобы обязательные символы не стояли всегда в начале.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function describeDatabase(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`
  } catch {
    return '(не удалось разобрать DATABASE_URL)'
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? ''
  if (!databaseUrl) throw new Error('DATABASE_URL не задан')

  if (process.env.RESET_CONFIRM !== 'RESET') {
    throw new Error(
      'Сброс не подтверждён. Это удаляет ВСЕ данные, кроме одного администратора.\n' +
        'Если действительно нужно — RESET_CONFIRM=RESET.',
    )
  }

  const remote = !isLocalDatabase(databaseUrl)
  if (remote && process.env.RESET_ALLOW_REMOTE !== '1') {
    throw new Error(
      `БД ${describeDatabase(databaseUrl)} не локальная, сброс заблокирован.\n` +
        'Если это осознанно (прод/стенд) — RESET_ALLOW_REMOTE=1.',
    )
  }

  const email = (process.env.RESET_ADMIN_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase()
  const generated = !process.env.RESET_ADMIN_PASSWORD
  const password = process.env.RESET_ADMIN_PASSWORD ?? generatePassword()

  console.log(`Сброс БД ${describeDatabase(databaseUrl)}${remote ? ' (удалённая)' : ''}`)

  const prisma = new PrismaClient()
  try {
    const tables = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const target = tables.map((t) => t.tablename).filter((t) => !KEEP_TABLES.includes(t))
    if (target.length === 0) {
      throw new Error('В схеме public нет таблиц — сначала примените миграции (pnpm db:deploy)')
    }

    const [{ n: usersBefore }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "public"."users"`,
    )
    console.log(`Было пользователей: ${usersBefore}; таблиц к очистке: ${target.length}`)

    // Один TRUNCATE на все таблицы: CASCADE снимает вопрос порядка внешних ключей,
    // RESTART IDENTITY обнуляет последовательности (нумерация начинается заново).
    const list = target.map((t) => `"public"."${t}"`).join(', ')
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)

    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        firstName: 'Платформенный',
        lastName: 'Администратор',
        role: 'PLATFORM_ADMIN',
      },
    })

    console.log('\nГотово. В базе один пользователь:')
    console.log(`  e-mail: ${email}`)
    if (generated) {
      console.log(`  пароль: ${password}`)
      console.log('  (сгенерирован — сохраните сейчас, второй раз он нигде не появится)')
    } else {
      console.log('  пароль: задан через RESET_ADMIN_PASSWORD')
    }
    console.log(
      '\nСправочник КАТО тоже очищен: без него пустой селект «Город» при создании вуза.\n' +
        'Восстановить — pnpm db:seed:kato.',
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`)
  process.exit(1)
})
