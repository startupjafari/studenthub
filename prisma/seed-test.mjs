// Тестовый стенд: второй вариант сида рядом с основным (`prisma/seed.mjs`).
//
// СОСТАВ ЗАДАН ПОИМЁННО (ТЗ): 1 админ платформы, 2 модератора платформы, 1 университет,
// 2 модератора университета, 2 декана, 24 преподавателя, 1450 учащихся (из них 58
// старост — по одному на группу), группы поровну. Плюс полностью заполненные профили,
// все справочники, личная галерея у каждого, посты, опросы, чаты, документы, карьера.
//
// ПОЧЕМУ ОТДЕЛЬНАЯ ТОЧКА ВХОДА, А НЕ ФЛАГ В seed.mjs. Требование «1 университет»
// означает ровно один. Основной сид безусловно заливает демо-вуз «Алатау» с named-
// аккаунтами (dean@studenthub.app и т. д.) — он вшит в его 1300 строк, на его id
// ссылаются PROJECT.md §14, dev-инвайт и e2e-тесты. Пытаться выключить его флагом
// внутри значило бы обвесить условиями весь файл; проще не звать его вовсе и собрать
// стенд из тех же шагов. Шаги переиспользуются один в один — расходиться нечему.
//
// Что НЕ создаётся здесь по сравнению с основным сидом: демо-вуз «Алатау», named-
// аккаунты ролей и демо-дополнения (жалобы и воронка инвайтов демо-вуза). Вход под
// ролями — по адресам сгенерированных пользователей, их печатает итог прогона.
//
// Запуск: `pnpm db:seed:test` (см. также AGENTS.md → Команды).

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { loadConfig } from './seed/config.mjs'
import { loadEnv } from './seed/lib/env.mjs'
import { makeRandom } from './seed/lib/rng.mjs'
import { reportSeedPassword, resolveSeedPassword } from './seed/lib/seed-password.mjs'
import { createProgress } from './seed/lib/progress.mjs'
import { createStorage } from './seed/lib/storage.mjs'
import { createWriter } from './seed/lib/writer.mjs'
import { person } from './seed/data/people.mjs'
import { staffProfile } from './seed/data/profiles.mjs'
import { seedUniversities } from './seed/index.mjs'
import { seedKato } from './seed/steps/00-kato.mjs'
import { seedServiceCatalog } from './seed/steps/05-service-catalog.mjs'
import { assignAvatars, seedMedia } from './seed/steps/10-media.mjs'
import { seedCompanies } from './seed/steps/15-companies.mjs'
import { seedUserMedia } from './seed/steps/57-user-media.mjs'

// Профиль масштаба здесь не выбирают: точка входа и ЕСТЬ профиль test. Если кто-то
// запустит её с SEED_SCALE=full, он получит 100 вузов под именем «тестовый стенд» —
// поэтому переменная выставляется до loadConfig, а не читается из окружения.
process.env.SEED_SCALE = 'test'

// DATABASE_URL живёт в apps/api/.env, а простой `node` его не читает: .env подхватывает
// только Prisma CLI через prisma.config.ts. Без этого `pnpm db:seed:test` падал бы на
// гарде «нелокальная БД» (пустой URL локальным не считается) ещё до первого запроса.
// Уже заданное окружение приоритетнее — на CI переменные приходят снаружи.
const env = loadEnv()
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL

const prisma = new PrismaClient()
const config = loadConfig()

// 2FA сбрасываем: стенд должен пускать по одному паролю. Форс 2FA на привилегированных
// ролях снимается локально через TWO_FACTOR_ENFORCE=false (apps/api/.env).
const TWO_FACTOR_RESET = {
  twoFactorEnabled: false,
  twoFactorSecret: null,
  twoFactorBackupCodes: [],
}

// Тот же резолвер, что и в основном сиде: на проде без SEED_PASSWORD пароль генерируется,
// а не берётся из репозитория (seed/lib/seed-password.mjs).
const seedPassword = resolveSeedPassword()
const PASSWORD = seedPassword.password
const CITY = 'Алматы'

// Зерно своё, не пересекается с основным сидом (20260812) и генератором вузов:
// платформенные аккаунты не должны меняться от прогона к прогону.
const random = makeRandom(20260916)

/**
 * Платформенные роли. Генератор вузов их не создаёт — он знает только про вуз.
 * Профиль заполняется теми же построителями, что у всех остальных: пустое поле в
 * профиле означает не отрисованный блок на экране, а стенд заводят как раз чтобы
 * эти блоки посмотреть.
 */
async function seedPlatformStaff(passwordHash) {
  const accounts = [
    { role: 'PLATFORM_ADMIN', email: 'admin@studenthub.app', position: 'Администратор платформы' },
  ]
  for (let i = 0; i < config.platformModerators; i += 1) {
    accounts.push({
      role: 'PLATFORM_MODERATOR',
      email: `moderator${i + 1}@studenthub.app`,
      position: 'Модератор платформы',
    })
  }

  const created = []
  for (const [i, account] of accounts.entries()) {
    const p = person(i, random)
    const profile = staffProfile(p, random, {
      template: null,
      profile: { timezone: 'Asia/Almaty' },
      cityName: CITY,
    })
    const data = {
      ...p,
      ...profile,
      position: account.position,
      jobTitle: account.position,
      responsibilities: 'Модерация, справочники, обращения вузов.',
      role: account.role,
      ...TWO_FACTOR_RESET,
    }
    const user = await prisma.user.upsert({
      where: { email: account.email },
      // update с профилем: стенд должен приходить в известное состояние при повторном
      // прогоне — в отличие от продовых аккаунтов основного сида.
      update: data,
      create: { email: account.email, passwordHash, ...data },
    })
    created.push({ ...account, id: user.id })

    await prisma.notificationSettings.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, emailEnabled: true, pushEnabled: true, systemEnabled: true },
    })
  }
  return created
}

async function main() {
  console.log(`Seed: профиль "${config.scale}" — ${config.scaleLabel}`)
  console.log(
    `  состав: 1 вуз, ${config.faculties} факультета, ${config.teachers} преподавателей, ` +
      `${config.studentsMin} учащихся, ${config.platformModerators} модератора платформы`,
  )
  console.log(
    `  медиа: пул ${config.photos} фото / ${config.videos} видео, ` +
      `каждому ${config.photosPerUser} фото и ${config.videosPerUser} видео`,
  )
  const progress = createProgress({ total: 1, label: 'Итого' })

  // ── Справочники ─────────────────────────────────────────────────────────────
  // КАТО первым: University.city хранит 9-значный код, и без справочника город вуза
  // не во что резолвить. Каталог услуг — глобальные шаблоны, на них ссылаются заявки.
  await seedKato(prisma)
  await seedServiceCatalog(prisma)

  // Один bcrypt-хэш на всех: 1500 хэшей с cost=12 — это минуты CPU впустую.
  const passwordHash = await bcrypt.hash(PASSWORD, 12)
  const platform = await seedPlatformStaff(passwordHash)
  console.log(`  платформенные аккаунты: ${platform.length}`)

  // ── Медиа-пул ───────────────────────────────────────────────────────────────
  // До вузов: аватары и обложки раздаются всем, включая уже созданных платформенных.
  const mediaPool = config.media ? await seedMedia(prisma, config) : null

  // ── Работодатели ────────────────────────────────────────────────────────────
  // До вуза: допуски и решения по вакансиям создаёт шаг карьеры внутри вуза.
  const companyWriter = createWriter(prisma, { chunkSize: config.chunkSize })
  const companies = await seedCompanies(prisma, companyWriter, { passwordHash })
  await companyWriter.flush()

  // ── Университет ─────────────────────────────────────────────────────────────
  const storage = config.media ? createStorage() : null
  await seedUniversities(prisma, {
    storage,
    config,
    passwordHash,
    pool: mediaPool,
    companies,
  })

  // Аватары тем, кто появился ПОСЛЕ раздачи в шаге медиа: работодатели и вузовские
  // роли создаются позже пула. Без этого у аккаунтов компаний профиль без лица.
  if (mediaPool) await assignAvatars(prisma, mediaPool)

  // ── Личная галерея ──────────────────────────────────────────────────────────
  // После вузов: обходит ВСЕХ пользователей, включая платформенных и работодателей.
  if (config.photosPerUser + config.videosPerUser > 0) {
    const mediaWriter = createWriter(prisma, { chunkSize: config.chunkSize })
    const counts = await seedUserMedia(prisma, mediaWriter, {
      config,
      pool: mediaPool,
      storage,
    })
    await mediaWriter.flush()
    console.log(
      `  галерея: ${counts.files} файлов в ${counts.albums} альбомах у ${counts.users} польз.`,
    )
  }

  await report(platform)
  progress.report({})
}

/** Итог прогона: что и под чем открывать. Без этого стендом нельзя пользоваться. */
async function report(platform) {
  const byRole = await prisma.user.groupBy({ by: ['role'], _count: { id: true } })
  console.log('\nСтенд готов.')
  reportSeedPassword(seedPassword)
  for (const account of platform) {
    console.log(`  ${account.role}: ${account.email}`)
  }
  // Адреса вузовских ролей детерминированы (lib/ids.mjs): admin@u001.edu.kz и т. д.
  console.log('  UNIVERSITY_ADMIN: admin@u001.edu.kz')
  console.log('  UNIVERSITY_MODERATOR: moderator.0@u001.edu.kz, moderator.1@u001.edu.kz')
  console.log('  DEAN: dean.<код факультета>@u001.edu.kz')
  console.log('  TEACHER: t.<код факультета>.<n>@u001.edu.kz')
  console.log('  STUDENT / STAROSTA: <код группы>.st<NN>@u001.edu.kz')
  console.log("    точный список: SELECT email, role FROM users WHERE university_id = 'u001';")
  console.log('\nПользователи по ролям:')
  for (const row of byRole.sort((a, b) => b._count.id - a._count.id)) {
    console.log(`  ${row.role}: ${row._count.id}`)
  }
  console.log('\n2FA сброшена. Чтобы форс не требовал настройки на привилегированных ролях:')
  console.log('  TWO_FACTOR_ENFORCE=false в apps/api/.env')
}

main()
  .catch((error) => {
    console.error('Seed упал:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
