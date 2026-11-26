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
// проверял обе ветки — повтор внутри окна (тот же преемник) и после него (разрыв цепочки).
process.env.REFRESH_REUSE_GRACE_MS = '300'
// Вход по ЭЦП (docs/PROJECT.md §8.3) включён, чтобы eds.e2e-spec проверял поток целиком.
// NCANode в e2e нет: спек подменяет EdsVerifier фейком, адрес нужен только схеме окружения
// (при включённом флаге он обязателен). Секрет ИИН — тестовый, к боевому отношения не имеет.
process.env.EDS_LOGIN_ENABLED = 'true'
process.env.NCANODE_URL = 'http://127.0.0.1:14579'
process.env.EDS_IIN_PEPPER = 'e2e-only-eds-iin-pepper-0123456789abcdef'
// Служебный Telegram-бот в тестах выключен принудительно: .env разработчика может
// содержать боевой токен, и e2e начали бы слать сообщения в рабочий чат команды.
delete process.env.TELEGRAM_BOT_TOKEN
// Медиа-задачи в e2e только ставятся в очередь, но не обрабатываются в процессе API.
// Inline-обработчик дописывал варианты картинки уже после конца теста и сцеплялся
// с TRUNCATE в beforeEach следующего — Postgres снимал TRUNCATE как дедлок (40P01).
// Варианты медиа e2e не проверяют: их покрывают unit-тесты media/.
process.env.MEDIA_PROCESSING = 'worker'
