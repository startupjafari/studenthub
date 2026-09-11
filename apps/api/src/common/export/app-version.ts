import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Версия приложения для метаданных выгружаемых файлов — из `package.json`, единственного
 * источника правды. Хардкодить версию в шаблонах запрещено планом брендирования.
 *
 * Читаем файл, а не импортируем: `rootDir: ./src` в tsconfig оставляет `package.json` вне
 * корня компиляции, и `import` сломал бы структуру `dist`. Пути-кандидаты — тот же приём,
 * что у `fontPath()` в career/resume-pdf.ts: от каталога модуля три уровня вверх дают
 * корень пакета и в `src/`, и в собранном `dist/`.
 */
function readPackageVersion(): string | null {
  const candidates = [
    join(__dirname, '..', '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
    join(process.cwd(), 'apps', 'api', 'package.json'),
  ]
  for (const path of candidates) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; version?: string }
      // Проверяем имя: в монорепо `process.cwd()` бывает корнем, и там свой package.json.
      if (raw.name?.endsWith('api') && raw.version) return raw.version
    } catch {
      // Файла нет или он не читается — пробуем следующий кандидат.
    }
  }
  return null
}

let cachedVersion: string | null = null

/** Версия пакета api. `unknown` — если package.json не нашёлся: метаданные не повод падать. */
export function appVersion(): string {
  cachedVersion ??= readPackageVersion() ?? 'unknown'
  return cachedVersion
}

/**
 * SHA сборки — необязательная метка происхождения в дополнение к версии.
 *
 * Не в `env.schema`: переменную подставляет платформа (Railway — `RAILWAY_GIT_COMMIT_SHA`),
 * требовать её в контракте окружения нельзя, а без неё всё работает. Тот же источник и тот
 * же порядок, что у сборки веба (apps/web/next.config.mjs).
 *
 * Зачем вообще: версия в `package.json` меняется только руками, и по одной ей нельзя
 * сказать, какой сборкой выпущен документ.
 */
export function buildSha(): string | null {
  const raw =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA
  return raw ? raw.slice(0, 12) : null
}
