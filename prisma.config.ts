import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Multi-file схема в prisma/schema/, миграции в prisma/migrations/ (см. docs/BACKEND_RULES.md §5).
//
// При наличии prisma.config.ts Prisma НЕ загружает .env автоматически, а DATABASE_URL у
// проекта живёт в apps/api/.env — в результате `pnpm db:deploy` из корня падал с P1012
// «Environment variable not found: DATABASE_URL». Читаем файл сами: dotenv в корневых
// зависимостях нет, а ради одного `KEY=VALUE` тянуть новую зависимость незачем.
//
// Уже заданное окружение не трогаем: на Railway и в CI переменные приходят снаружи, файла
// там нет вовсе, и приоритет должен оставаться за ними.
function loadApiEnv(): void {
  const file = path.join(__dirname, 'apps', 'api', '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (!key || process.env[key] !== undefined) continue
    // Снимаем обрамляющие кавычки и хвостовой комментарий у незакавыченных значений.
    const value = (rawValue ?? '').trim()
    const unquoted = /^(['"])(.*)\1$/.exec(value)
    process.env[key] = unquoted ? (unquoted[2] ?? '') : value.replace(/\s+#.*$/, '')
  }
}

loadApiEnv()

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
})
