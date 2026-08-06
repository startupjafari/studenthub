const fs = require('node:fs')
const path = require('node:path')

// URL тестовой БД: из окружения (CI) или из apps/api/.env (DATABASE_URL_TEST).
function readTestDbUrl() {
  if (process.env.DATABASE_URL_TEST) {
    return process.env.DATABASE_URL_TEST
  }
  const envPath = path.join(__dirname, '..', '.env')
  const text = fs.readFileSync(envPath, 'utf8')
  const match = text.match(/^DATABASE_URL_TEST=(.*)$/m)
  if (!match) {
    throw new Error('DATABASE_URL_TEST не найден (apps/api/.env или окружение)')
  }
  return match[1].trim()
}

module.exports = { readTestDbUrl }
