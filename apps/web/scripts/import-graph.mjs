// Граф импортов исходников веба — общий для генератора областей словаря
// (scripts/i18n-scopes.mjs) и тестов-стражей бандла.
//
// Разбор регулярками, а не компилятором TypeScript: нужен только список импортов и
// пространств имён `useTranslations('Ns')`, а прогон через tsc на ~2000 файлов шёл бы
// секундами. Где разбор не уверен, он берёт модуль целиком: ошибка уходит в лишнее
// пространство имён, а не в потерянное.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SRC = path.join(WEB_ROOT, 'src')
export const APP = path.join(SRC, 'app')

/** Слои FSD — алиасы из tsconfig.json (`shared/*` → `src/shared/*` и т. д.). */
const ALIASES = ['shared', 'entities', 'features', 'widgets', 'views']

// `import … from 'x'`, `export … from 'x'`, `import 'x'`, `import('x')`. В предложении
// импорта не бывает `=`, скобок и кавычек — так регулярка не перешагнёт через соседний
// оператор в файле без точек с запятой.
const STATEMENT_RE =
  /\b(import|export)\s+(type\s+)?([^'";=()]*?)\s*from\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const NAMESPACE_RE = /\b(?:useTranslations|getTranslations)\(\s*['"]([A-Za-z0-9_]+)/g
const CLIENT_RE = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/
const REEXPORT_RE =
  /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"][^'"]+['"];?\s*$/gm
const LINE_COMMENT_RE = /^\s*\/\/.*$/gm
const BLOCK_COMMENT_RE = /^\s*\/\*[\s\S]*?\*\/\s*$/gm

/** Сам модуль целиком — когда разбор не знает, какие имена из него берут. */
const ALL = '*'

const parsed = new Map()

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

/**
 * Файл исходников по спецификатору импорта; пакеты из node_modules — `null`.
 * @param {string} specifier
 * @param {string} fromFile
 * @returns {string | null}
 */
export function resolveImport(specifier, fromFile) {
  if (specifier.startsWith('.')) return resolveFile(path.resolve(path.dirname(fromFile), specifier))
  if (ALIASES.includes(specifier.split('/')[0])) return resolveFile(path.join(SRC, specifier))
  return null
}

/**
 * Имена из предложения импорта/реэкспорта: `X`, `{ a, b as c }`, `* as ns`, `X, { a }`.
 * Возвращает пары [имя в модуле-источнике, имя снаружи] или ALL.
 */
function clauseNames(clause) {
  if (clause.includes('*')) return ALL
  const pairs = []
  const braces = clause.match(/\{([\s\S]*)\}/)
  const head = clause
    .replace(/\{[\s\S]*\}/, '')
    .replace(/,/g, ' ')
    .trim()
  if (head) pairs.push(['default', head])
  if (braces) {
    for (const part of braces[1].split(',')) {
      const item = part.trim()
      if (!item || item.startsWith('type ')) continue
      const [source, alias] = item.split(/\s+as\s+/)
      pairs.push([source.trim(), (alias ?? source).trim()])
    }
  }
  return pairs
}

function parse(file) {
  let info = parsed.get(file)
  if (info) return info
  const source = readFileSync(file, 'utf8')
  const edges = []
  for (const match of source.matchAll(STATEMENT_RE)) {
    if (match[2]) continue // import type / export type
    const target = resolveImport(match[4] ?? match[5] ?? match[6], file)
    if (!target || /\.(test|spec)\.tsx?$/.test(target)) continue
    const names = match[3] === undefined ? ALL : clauseNames(match[3])
    // `import 'x'`, `import('x')`, `import * as x` — модуль целиком.
    // `export * from` (без `as`) — сквозной реэкспорт: имя ищется дальше по цепочке.
    const passThrough = match[1] === 'export' && match[3]?.trim() === '*'
    edges.push({ target, names, passThrough })
  }
  // Barrel — index-файл из одних реэкспортов: через него проходят только запрошенные имена.
  const rest = source
    .replace(BLOCK_COMMENT_RE, '')
    .replace(LINE_COMMENT_RE, '')
    .replace(REEXPORT_RE, '')
    .trim()
  info = {
    source,
    edges,
    barrel: /\/index\.tsx?$/.test(file) && rest === '',
    client: CLIENT_RE.test(source),
  }
  parsed.set(file, info)
  return info
}

/**
 * Модуль с директивой `'use client'` — граница клиентского кода.
 * @param {string} file
 * @returns {boolean}
 */
export function isClientModule(file) {
  return parse(file).client
}

/**
 * Импортируемые файлы исходников (без `import type`, без тестов).
 * @param {string} file
 * @returns {string[]}
 */
export function importsOf(file) {
  return parse(file).edges.map((edge) => edge.target)
}

/**
 * Пространства имён словаря, которые нужны КЛИЕНТСКОМУ коду, достижимому от точек входа.
 *
 * Серверным компонентам словарь на клиенте не нужен: `getTranslations` и `useTranslations`
 * на сервере читают его из конфигурации запроса (src/i18n/request.ts). Поэтому модуль
 * считается, только если он клиентский — с директивой или импортирован из клиентского.
 *
 * Barrel проходится по именам: `import { Button } from 'shared/ui'` ведёт только в
 * button.tsx, а не во все шестьдесят компонентов слоя. Неиспользованный реэкспорт не
 * отрисуется никогда, значит, и словарь ему не нужен. Обычный модуль берётся целиком.
 *
 * @param {string[]} entries
 * @returns {Set<string>}
 */
export function clientNamespaces(entries) {
  const namespaces = new Set()
  /** файл → { client, all, names } — что уже пройдено */
  const state = new Map()
  const stack = entries.map((file) => ({ file, fromClient: false, names: ALL }))
  while (stack.length > 0) {
    const { file, fromClient, names } = stack.pop()
    const info = parse(file)
    const client = fromClient || info.client
    let seen = state.get(file)
    const first = !seen
    if (!seen) {
      seen = { client: false, all: false, names: new Set() }
      state.set(file, seen)
    }
    const becameClient = client && !seen.client
    if (client) seen.client = true

    if (!info.barrel) {
      if (!first && !becameClient) continue
      if (client) for (const match of info.source.matchAll(NAMESPACE_RE)) namespaces.add(match[1])
      for (const edge of info.edges) {
        const wanted = edge.names === ALL ? ALL : edge.names.map(([source]) => source)
        stack.push({ file: edge.target, fromClient: client, names: wanted })
      }
      continue
    }

    // Barrel: какие имена проходим впервые (или все — если модуль стал клиентским).
    let wanted
    if (becameClient) {
      wanted = seen.all || names === ALL ? ALL : [...new Set([...seen.names, ...names])]
    } else if (seen.all) {
      continue
    } else if (names === ALL) {
      wanted = ALL
    } else {
      wanted = names.filter((name) => !seen.names.has(name))
      if (wanted.length === 0) continue
    }
    if (wanted === ALL) seen.all = true
    else for (const name of wanted) seen.names.add(name)

    for (const edge of info.edges) {
      if (edge.passThrough) {
        // `export * from` — имя может прийти откуда угодно, передаём запрос дальше.
        stack.push({ file: edge.target, fromClient: client, names: wanted })
        continue
      }
      if (edge.names === ALL) {
        stack.push({ file: edge.target, fromClient: client, names: ALL })
        continue
      }
      const hits =
        wanted === ALL ? edge.names : edge.names.filter(([, alias]) => wanted.includes(alias))
      if (hits.length > 0) {
        stack.push({ file: edge.target, fromClient: client, names: hits.map(([source]) => source) })
      }
    }
  }
  return namespaces
}

/**
 * Все .ts/.tsx файлы каталога рекурсивно (без тестов), с фильтром по пути.
 * @param {string} dir
 * @param {(file: string) => boolean} [filter]
 * @param {string[]} [out]
 * @returns {string[]}
 */
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

/**
 * Путь относительно src/ с прямыми слэшами — для сообщений тестов.
 * @param {string} file
 * @returns {string}
 */
export const rel = (file) => path.relative(SRC, file).split(path.sep).join('/')
