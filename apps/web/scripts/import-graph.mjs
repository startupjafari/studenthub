// Граф импортов исходников веба — общий для генератора областей словаря
// (scripts/i18n-scopes.mjs) и тестов-стражей бандла (src/shared/i18n/*.test.ts).
//
// Разбор регулярками, а не компилятором TypeScript: нужен только список импортов и
// пространств имён `useTranslations('Ns')`, а прогон через tsc на ~2000 файлов шёл бы
// секундами. Ошибается разбор в безопасную сторону: лишний импорт (скажем, в комментарии)
// даёт лишнее пространство имён, а не потерянное.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SRC = path.join(WEB_ROOT, 'src')
export const APP = path.join(SRC, 'app')

/** Слои FSD — алиасы из tsconfig.json (`shared/*` → `src/shared/*` и т. д.). */
const ALIASES = ['shared', 'entities', 'features', 'widgets', 'views']

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const TYPE_ONLY_RE = /^(?:import|export)\s+type\s/
const NAMESPACE_RE = /\b(?:useTranslations|getTranslations)\(\s*['"]([A-Za-z0-9_]+)/g
const CLIENT_RE = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/

const sourceCache = new Map()
function read(file) {
  let src = sourceCache.get(file)
  if (src === undefined) {
    src = readFileSync(file, 'utf8')
    sourceCache.set(file, src)
  }
  return src
}

function resolveFile(base) {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Файл исходников по спецификатору импорта; пакеты из node_modules — `null`. */
export function resolveImport(specifier, fromFile) {
  if (specifier.startsWith('.')) return resolveFile(path.resolve(path.dirname(fromFile), specifier))
  if (ALIASES.includes(specifier.split('/')[0])) return resolveFile(path.join(SRC, specifier))
  return null
}

/** Модуль с директивой `'use client'` — граница клиентского кода. */
export function isClientModule(file) {
  return CLIENT_RE.test(read(file))
}

/** Импортируемые файлы исходников (без `import type`, без тестов). */
export function importsOf(file) {
  const out = []
  for (const match of read(file).matchAll(IMPORT_RE)) {
    if (TYPE_ONLY_RE.test(match[0])) continue
    const target = resolveImport(match[1] ?? match[2], file)
    if (target && !/\.(test|spec)\.tsx?$/.test(target)) out.push(target)
  }
  return out
}

/**
 * Пространства имён словаря, которые нужны КЛИЕНТСКОМУ коду, достижимому от точек входа.
 *
 * Серверным компонентам словарь на клиенте не нужен: `getTranslations` и `useTranslations`
 * на сервере читают его из конфигурации запроса (src/i18n/request.ts). Поэтому модуль
 * считается, только если он клиентский — с директивой или импортирован из клиентского.
 * Импорт через barrel засчитывает весь barrel: это перебор, но в безопасную сторону.
 */
export function clientNamespaces(entries) {
  /** файл → посещён ли уже как клиентский */
  const seen = new Map()
  const namespaces = new Set()
  const stack = entries.map((file) => [file, false])
  while (stack.length > 0) {
    const [file, fromClient] = stack.pop()
    const client = fromClient || isClientModule(file)
    const prev = seen.get(file)
    if (prev === true || (prev === false && !client)) continue
    seen.set(file, client)
    if (client) for (const match of read(file).matchAll(NAMESPACE_RE)) namespaces.add(match[1])
    for (const target of importsOf(file)) stack.push([target, client])
  }
  return namespaces
}

/** Все файлы каталога рекурсивно (без тестов). */
export function listFiles(dir, filter = () => true, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) listFiles(full, filter, out)
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && filter(full)) {
      out.push(full)
    }
  }
  return out
}

/** Путь относительно src/ с прямыми слэшами — для сообщений тестов. */
export const rel = (file) => path.relative(SRC, file).split(path.sep).join('/')
