// Наполнение библиотеки одного вуза данными (Фаза 20): каталог, история выдач, просрочки,
// брони, журнал просмотров удостоверений, ход инвентаризации. Для локальной базы, где вуз
// уже засеян (мега-сид или стенд), а библиотеки в нём ещё нет.
//
// Запуск: `pnpm db:seed:library` — вуз из SEED_LIBRARY_UNIVERSITY, иначе вуз первого
// библиотекаря. Повторный запуск по тому же вузу ничего не делает. В удалённую базу —
// только с SEED_ALLOW_REMOTE=1, как и остальной сид.

import { PrismaClient } from '@prisma/client'
import { loadEnv } from './seed/lib/env.mjs'
import { makeRandom, SEED_BASE } from './seed/lib/rng.mjs'
import { isLocalDatabase } from './seed/config.mjs'
import { seedLibrary } from './seed/steps/45-library.mjs'

const env = loadEnv()
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL
if (!isLocalDatabase(process.env.DATABASE_URL) && process.env.SEED_ALLOW_REMOTE !== '1') {
  console.error('seed-library: база не локальная — задайте SEED_ALLOW_REMOTE=1, если это осознанно')
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  let universityId = process.env.SEED_LIBRARY_UNIVERSITY
  if (!universityId) {
    const librarian = await prisma.user.findFirst({
      where: { role: 'LIBRARIAN', deletedAt: null, universityId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { universityId: true },
    })
    universityId = librarian?.universityId ?? undefined
  }
  if (!universityId) {
    console.error('seed-library: укажите вуз в SEED_LIBRARY_UNIVERSITY — библиотекарей в базе нет')
    process.exit(1)
  }
  const result = await seedLibrary(prisma, { universityId, random: makeRandom(SEED_BASE + 45) })
  if (result.skipped) {
    console.log(
      `seed-library: вуз ${universityId} — пропущено (${result.reason ?? 'уже заполнено'})`,
    )
    return
  }
  console.log(
    `seed-library: вуз ${universityId} — книг ${result.books}, экземпляров ${result.copies}, ` +
      `выдач ${result.loans} (на руках ${result.open}, просрочено ${result.overdue}), броней ${result.reservations}`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
