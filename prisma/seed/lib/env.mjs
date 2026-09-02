// Загрузка окружения для сида.
//
// При наличии prisma.config.ts Prisma НЕ читает .env сама (см. комментарий в
// prisma.config.ts), а сиду нужны не только DATABASE_URL, но и доступ к MinIO. Читаем
// apps/api/.env как файл-источник по умолчанию: это тот же файл, из которого берёт
// настройки локальный API, так что расхождения между «что видит сид» и «что видит
// приложение» не возникает. Переменные, уже заданные в окружении, приоритетнее.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const API_ENV = fileURLToPath(new URL('../../../apps/api/.env', import.meta.url))

// Минимальный парсер .env: KEY=VALUE, комментарии с #, кавычки по краям снимаются.
// Полноценный dotenv не тянем — это одна зависимость ради двадцати строк.
function parseEnvFile(path) {
  const result = {}
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

let cached = null

export function loadEnv() {
  if (cached) return cached
  const fromFile = existsSync(API_ENV) ? parseEnvFile(API_ENV) : {}
  cached = { ...fromFile, ...process.env }
  return cached
}
