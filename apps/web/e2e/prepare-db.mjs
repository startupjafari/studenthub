// Подготовка изолированной БД для e2e: миграции + seed на DATABASE_URL_TEST.
// Запускается ДО playwright (см. скрипт `e2e` в package.json), а не из globalSetup —
// порядок globalSetup и webServer в Playwright не гарантирован, а api должен стартовать
// уже на готовой схеме.

import { execFileSync } from 'node:child_process'

import { readEnv, REPO_ROOT as ROOT } from './support/test-env.cjs'

const databaseUrl = readEnv('DATABASE_URL_TEST')
if (!databaseUrl) {
  console.error('DATABASE_URL_TEST не задан — e2e нужна отдельная БД, dev-данные трогать нельзя')
  process.exit(1)
}
if (databaseUrl === readEnv('DATABASE_URL')) {
  console.error('DATABASE_URL_TEST совпадает с DATABASE_URL — прогон затёр бы рабочие данные')
  process.exit(1)
}
// Вторая страховка к сравнению выше: ниже идёт --force-reset, и цена ошибки в конфиге — снесённая база.
if (!/test|e2e/i.test(new URL(databaseUrl).pathname)) {
  console.error(
    `Отказываюсь сбрасывать БД "${new URL(databaseUrl).pathname.slice(1)}": имя не похоже на тестовое`,
  )
  process.exit(1)
}

function run(cmd, args) {
  try {
    execFileSync(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        REDIS_HOST: readEnv('REDIS_HOST') ?? 'localhost',
        REDIS_PORT: readEnv('REDIS_PORT') ?? '6379',
      },
    })
  } catch {
    // execFileSync печатает свой стектрейс поверх вывода команды — он тут только мешает.
    console.error(`\ne2e: команда не выполнилась — ${cmd} ${args.join(' ')}`)
    console.error('Если Prisma требует подтверждения сброса, задайте')
    console.error('PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<текст вашего согласия>.')
    process.exit(1)
  }
}

// Тестовую БД проект ведёт через db push, а не миграции (BACKEND_RULES §11): истории миграций
// в ней нет. --force-reset даёт чистую схему на каждый прогон, поэтому тесты не зависят от
// мусора, оставленного предыдущим. Для не-тестовой БД это запрещено — отсюда две проверки выше.
console.log('e2e: пересоздаю схему тестовой БД')
run('npx', ['--no-install', 'prisma', 'db', 'push', '--skip-generate', '--force-reset'])
console.log('e2e: заполняю тестовыми данными')
run('node', ['prisma/seed.mjs'])

// Redis переживает сброс Postgres, а часть состояния завязана на id пользователей — они у seed
// фиксированные. Ключ `chat:ensured:<userId>` на 10 минут гейтит автосоздание официальных чатов
// (chats.service.ts): не сбросив его, следующий прогон получил бы пустой список чатов.
// Это уборка тестового окружения, а не отключение логики: чистим только свои ключи.
console.log('e2e: сбрасываю кэш-флаги Redis')
run('pnpm', [
  '--filter',
  'api',
  'exec',
  'node',
  '-e',
  `
  const Redis = require('ioredis')
  const r = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
  })
  const stream = r.scanStream({ match: 'chat:ensured:*', count: 100 })
  let removed = 0
  stream.on('data', (keys) => {
    if (keys.length) { removed += keys.length; r.del(...keys) }
  })
  stream.on('end', () => {
    console.log('  удалено ключей: ' + removed)
    r.quit()
  })
  `,
])
