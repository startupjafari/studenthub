// Области словаря: какие пространства имён отдавать клиенту на каком маршруте.
//
//   pnpm --filter web i18n:scopes      — пересобрать src/i18n/message-scopes.json
//
// Зачем (задача 21.B4). Словарь целиком — ~400 КБ на язык, и корневой layout отдавал его
// клиенту на каждой странице: строкой в RSC-потоке внутри HTML, которую браузер качает и
// разбирает до гидратации. Странице входа из него нужно ~40 КБ.
//
// Как устроено. Область — каталог в src/app, чей layout.tsx оборачивает детей в
// `<MessagesScope scope="…">` (src/i18n/messages-scope.tsx). Корень — область "/",
// её словарь отдаёт корневой layout. Каждый файл маршрута (page, loading, error, …)
// приписывается ближайшей области сверху; layout самой области — родительской, потому
// что он рисуется снаружи своего MessagesScope. Пространства имён файла — то, что
// использует достижимый от него клиентский код (scripts/import-graph.mjs). В область
// попадает всё, чего нет у её предков: вложенные провайдеры словарь объединяют.
//
// Страж — src/shared/i18n/message-scopes.test.ts: падает, если JSON устарел.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP, SRC, clientNamespaces, listFiles } from './import-graph.mjs'

export const ROOT_SCOPE = '/'
export const SCOPES_FILE = path.join(SRC, 'i18n', 'message-scopes.json')

/**
 * Пространства имён, которые корень отдаёт всегда, что бы ни показал разбор импортов:
 * общие подписи, тексты ошибок API и сообщения валидации форм. Их читают общие хелперы
 * (тосты ошибок, FieldError, FormAlert), которые зовут почти все экраны, — сырой ключ
 * вместо текста ошибки хуже лишних килобайт.
 */
const ALWAYS_IN_ROOT = ['Common', 'Errors', 'Validation']

/** Файлы маршрута, которые рисуются внутри корневого layout. global-error — снаружи. */
const ROUTE_FILE_RE = /^(page|layout|loading|error|not-found|template|default)\.tsx$/
const SCOPE_RE = /<MessagesScope\s+scope=["']([^"']+)["']/

const toScopeId = (dir) => {
  const relative = path.relative(APP, dir).split(path.sep).join('/')
  return relative === '' ? ROOT_SCOPE : relative
}

/** Каталоги-области: их layout.tsx объявляет MessagesScope со своим путём. */
function findScopes() {
  const scopes = new Set([ROOT_SCOPE])
  for (const file of listFiles(APP, (f) => path.basename(f) === 'layout.tsx')) {
    const match = readFileSync(file, 'utf8').match(SCOPE_RE)
    if (!match) continue
    const id = toScopeId(path.dirname(file))
    if (match[1] !== id) {
      throw new Error(
        `${path.relative(SRC, file)}: MessagesScope scope="${match[1]}", ожидается "${id}"`,
      )
    }
    scopes.add(id)
  }
  return scopes
}

/** Ближайшая область, внутри которой рисуется файл маршрута. */
function ownerScope(file, scopes) {
  let dir = path.dirname(file)
  // layout области рисуется снаружи своего MessagesScope — его словарь даёт родитель.
  if (path.basename(file) === 'layout.tsx' && dir !== APP && scopes.has(toScopeId(dir))) {
    dir = path.dirname(dir)
  }
  while (!scopes.has(toScopeId(dir))) dir = path.dirname(dir)
  return toScopeId(dir)
}

const parentScopes = (id, scopes) =>
  id === ROOT_SCOPE
    ? []
    : [
        ROOT_SCOPE,
        ...id
          .split('/')
          .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
          .slice(0, -1)
          .filter((candidate) => scopes.has(candidate)),
      ]

/** @returns {Record<string, string[]>} */
export function computeScopes() {
  const scopes = findScopes()
  const needs = new Map([...scopes].map((id) => [id, new Set()]))
  for (const ns of ALWAYS_IN_ROOT) needs.get(ROOT_SCOPE).add(ns)
  for (const file of listFiles(APP, (f) => ROUTE_FILE_RE.test(path.basename(f)))) {
    const owner = ownerScope(file, scopes)
    for (const ns of clientNamespaces([file])) needs.get(owner).add(ns)
  }
  // От корня вглубь: области достаётся только то, чего нет у предков.
  const result = {}
  const ordered = [...scopes].sort((a, b) =>
    a === ROOT_SCOPE
      ? -1
      : b === ROOT_SCOPE
        ? 1
        : a.split('/').length - b.split('/').length || a.localeCompare(b),
  )
  for (const id of ordered) {
    const inherited = new Set(parentScopes(id, scopes).flatMap((parent) => result[parent]))
    result[id] = [...needs.get(id)].filter((ns) => !inherited.has(ns)).sort()
  }
  return result
}

/** JSON в том виде, в каком его оставит prettier из pre-commit, — без лишних диффов. */
async function serializeScopes(scopes) {
  const prettier = await import('prettier')
  const options = await prettier.resolveConfig(SCOPES_FILE)
  return prettier.format(JSON.stringify(scopes), { ...options, filepath: SCOPES_FILE })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const scopes = computeScopes()
  writeFileSync(SCOPES_FILE, await serializeScopes(scopes))
  const dict = JSON.parse(readFileSync(path.join(SRC, '..', 'messages', 'ru.json'), 'utf8'))
  const kb = (list) =>
    Math.round(
      Buffer.byteLength(JSON.stringify(Object.fromEntries(list.map((ns) => [ns, dict[ns]])))) /
        1024,
    )
  console.log(
    `message-scopes.json: ${Object.keys(scopes).length} областей; словарь ru — ${kb(Object.keys(dict))} КБ`,
  )
  for (const [id, list] of Object.entries(scopes)) {
    console.log(`  ${id.padEnd(36)} ${String(list.length).padStart(3)} пространств, ${kb(list)} КБ`)
  }
}
