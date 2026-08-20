// Конфигурация e2e-стенда: prisma.config.ts намеренно не читает .env, поэтому DATABASE_URL_TEST
// и параметры Redis прогон берёт сам — сначала из окружения, затем из apps/api/.env.
//
// Модуль общий для обоих участников прогона: prepare-db.mjs (схема + seed) и playwright.config.ts
// (env для api-сервера). Раньше fallback на .env был только в первом, и `pnpm --filter web e2e`
// падал у любого, кто не экспортировал DATABASE_URL_TEST в шелл: схема готовилась, а api стартовал
// с пустым DATABASE_URL и падал на валидации окружения.
//
// CommonJS, а не .mjs: свой конфиг Playwright транспилирует в CJS, и настоящий ESM-модуль оттуда
// не загрузить (`exports is not defined in ES module scope`). CJS же импортируется из обоих миров.

const { readFileSync } = require('node:fs')
const path = require('node:path')

/** Корень монорепо: e2e/support → e2e → web → apps → repo. */
const REPO_ROOT = path.resolve(__dirname, '../../../..')

/**
 * Значение переменной окружения с fallback на apps/api/.env. Приоритет у process.env: так прогон
 * можно направить на другую БД (CI, локальный эксперимент), не правя файл.
 *
 * @param {string} name
 * @returns {string | undefined}
 */
function readEnv(name) {
  const fromProcess = process.env[name]
  if (fromProcess) return fromProcess
  let file
  try {
    file = readFileSync(path.join(REPO_ROOT, 'apps/api/.env'), 'utf8')
  } catch {
    // Файла нет (CI задаёт всё окружением) — значит и fallback'а нет.
    return undefined
  }
  const line = file.split('\n').find((l) => l.startsWith(`${name}=`))
  return line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^"|"$/g, '')
}

module.exports = { REPO_ROOT, readEnv }
