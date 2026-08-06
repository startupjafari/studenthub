const { execSync } = require('node:child_process')
const path = require('node:path')
const { readTestDbUrl } = require('./read-test-db.cjs')

// Одноразово перед e2e: заливаем актуальную схему в тестовую БД через prisma db push
// (§11 — db push допустим только для тестовой БД).
module.exports = async () => {
  const repoRoot = path.join(__dirname, '..', '..', '..')
  execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: readTestDbUrl() },
    stdio: 'inherit',
  })
}
