const fs = require('node:fs')
const path = require('node:path')
const { readTestDbUrl } = require('./read-test-db.cjs')

// Загружаем apps/api/.env в process.env (не перезаписывая уже заданные), затем
// принудительно направляем приложение на тестовую БД. В CI .env нет — переменные
// приходят из окружения workflow, поэтому отсутствие файла не критично.
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

process.env.DATABASE_URL = readTestDbUrl()
process.env.NODE_ENV = 'test'
// В e2e привилегированные роли используются без 2FA — форс выключаем (в проде по умолчанию включён).
process.env.TWO_FACTOR_ENFORCE = 'false'
// Окно грации при повторе ротированного refresh-токена: в тестах узкое, чтобы один прогон
// проверял обе ветки — повтор внутри окна (новая ротация) и после него (разрыв цепочки).
process.env.REFRESH_REUSE_GRACE_MS = '300'
