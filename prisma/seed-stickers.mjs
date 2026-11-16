// Набор стикеров StudentHub (собственный, без чужой графики): картинки из
// prisma/seed/stickers/ → бакет чатов, опубликованный набор `studenthub`.
//
// Запуск: `pnpm db:seed:stickers`. Нужны MinIO и уже засеянный PLATFORM_ADMIN (владелец
// файлов). Повторный запуск докладывает только недостающее. В удалённую базу — только с
// SEED_ALLOW_REMOTE=1, как и остальной сид.

import { PrismaClient } from '@prisma/client'
import { loadEnv } from './seed/lib/env.mjs'
import { isLocalDatabase } from './seed/config.mjs'
import { createStorage } from './seed/lib/storage.mjs'
import { seedStickers } from './seed/steps/95-stickers.mjs'

const env = loadEnv()
if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL
if (!isLocalDatabase(process.env.DATABASE_URL) && process.env.SEED_ALLOW_REMOTE !== '1') {
  console.error(
    'seed-stickers: база не локальная — задайте SEED_ALLOW_REMOTE=1, если это осознанно',
  )
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const result = await seedStickers(prisma, createStorage())
  if (result.skipped) {
    console.error(`seed-stickers: пропущено — ${result.reason}`)
    process.exitCode = 1
    return
  }
  console.log(
    `seed-stickers: набор «studenthub» — новых стикеров ${result.created}, всего ${result.total}`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
