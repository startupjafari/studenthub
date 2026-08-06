import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Multi-file схема в prisma/schema/, миграции в prisma/migrations/ (см. docs/BACKEND_RULES.md §5).
// Внимание: при наличии prisma.config.ts Prisma НЕ загружает .env автоматически —
// DATABASE_URL передаётся окружением (dev-скрипты apps/api на следующих фазах).
export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
})
