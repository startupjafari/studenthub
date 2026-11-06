// Автоматическая часть аудита безопасности по чеклисту docs/BACKEND_RULES.md §14 (план 13.5).
//
//   node scripts/security-audit.mjs            # markdown-отчёт в stdout
//   node scripts/security-audit.mjs --json     # то же машинно-читаемым JSON
//
// Без зависимостей и без запуска приложения: читает исходники apps/api/src, реестр
// apps/api/openapi.json и таблицу публичных маршрутов из docs/BACKEND_RULES.md §6.1.
// Разбор декораторов — построчный и намеренно простой (не TypeScript AST): контроллеры в
// проекте написаны в одном стиле, а расхождение с openapi.json скрипт показывает сам —
// значит, если разбор что-то пропустил, это видно в разделе «Сверка с реестром».
//
// Скрипт НАХОДИТ кандидатов, а не выносит приговор: «эндпоинт без @Roles» законен, если
// сервис сам режет выдачу по scope из токена. Разбор кандидатов — в docs/SECURITY_AUDIT.md.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const API_SRC = path.join(ROOT, 'apps/api/src')
const AS_JSON = process.argv.includes('--json')

// ---------------------------------------------------------------------------------------------
// Файлы

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__testing__') continue
      walk(full, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

const rel = (file) => path.relative(ROOT, file)
const SOURCES = walk(API_SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

/** Строка (с 1) по смещению в тексте. */
function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

/**
 * Конец литерала, начинающегося в `i` (кавычка, обратная кавычка или `/` регулярки), —
 * индекс его последнего символа. Строки в кавычках не переносятся, поэтому перевод строки
 * тоже их закрывает: ошибка распознавания (апостроф внутри регулярки) не утягивает за собой
 * остаток файла. В шаблонной строке `${…}` разбирается как код — со своими строками внутри.
 */
function skipLiteral(text, i) {
  const quote = text[i]
  if (quote === '`') {
    for (let j = i + 1; j < text.length; j += 1) {
      if (text[j] === '\\') j += 1
      else if (text[j] === '`') return j
      else if (text[j] === '$' && text[j + 1] === '{') {
        let depth = 0
        for (j += 1; j < text.length; j += 1) {
          const c = text[j]
          if (c === "'" || c === '"' || c === '`') j = skipLiteral(text, j)
          else if (c === '{') depth += 1
          else if (c === '}') {
            depth -= 1
            if (depth === 0) break
          }
        }
      }
    }
    return text.length - 1
  }
  let inClass = false
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j]
    if (c === '\\') j += 1
    else if (c === '\n') return j - 1
    else if (quote === '/' && c === '[') inClass = true
    else if (quote === '/' && c === ']') inClass = false
    else if (c === quote && !inClass) return j
  }
  return text.length - 1
}

/** `/` в позиции `i` открывает регулярку, а не делит: перед ней оператор или скобка. */
function startsRegex(text, i) {
  let k = i - 1
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k -= 1
  return k < 0 || '(,=:[!&|?{};\n'.includes(text[k])
}

/**
 * Убрать комментарии, сохранив переносы строк (номера строк остаются верными). Литералы
 * пропускаются целиком — внутри них `//` бывает в URL, а `/*` в glob-шаблонах.
 */
function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
    } else if (c === '/' && n === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n'
        i += 1
      }
      i += 2
    } else if (c === "'" || c === '"' || c === '`' || (c === '/' && startsRegex(text, i))) {
      const end = skipLiteral(text, i)
      out += text.slice(i, end + 1)
      i = end + 1
    } else {
      out += c
      i += 1
    }
  }
  return out
}

/** Индекс закрывающей скобки для открывающей в позиции `open` (учитывает литералы). */
function matchParen(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const stack = []
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`' || (c === '/' && startsRegex(text, i))) {
      i = skipLiteral(text, i)
      continue
    }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === ')' || c === '}' || c === ']') {
      stack.pop()
      if (stack.length === 0) return i
    }
  }
  return -1
}

/**
 * Начало тела метода после закрывающей скобки сигнатуры. Первая `{` не годится: у
 * `Promise<{ id: string }>` она открывает тип возврата. Тело в проекте всегда начинается
 * скобкой в конце строки (prettier), литерал типа — посреди строки.
 */
function bodyStart(text, sigClose) {
  const m = /\{[ \t]*\n/.exec(text.slice(sigClose))
  return m ? sigClose + m.index : -1
}

// ---------------------------------------------------------------------------------------------
// Реестр эндпоинтов: разбор контроллеров

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'])

function firstString(args) {
  const m = args.match(/['"`]([^'"`]*)['"`]/)
  return m ? m[1] : null
}

function parseDecorator(raw) {
  const m = raw.match(/^@(\w+)\s*\(([\s\S]*)\)\s*$/)
  return m ? { name: m[1], args: m[2].trim() } : { name: raw.replace(/^@/, ''), args: '' }
}

function joinPath(...parts) {
  const joined = parts
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
  return `/${joined}`.replace(/:(\w+)/g, '{$1}')
}

/**
 * Разобрать контроллер: декораторы класса и каждого обработчика. Декоратор может
 * растягиваться на несколько строк — читаем до баланса скобок.
 */
function parseController({ file, text }) {
  const clean = stripComments(text)
  const lines = clean.split('\n')
  const endpoints = []
  let pending = []
  let classDecorators = null
  let className = null
  let classLine = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line.startsWith('@')) {
      let raw = line
      let depth = (raw.match(/\(/g) ?? []).length - (raw.match(/\)/g) ?? []).length
      while (depth > 0 && i + 1 < lines.length) {
        i += 1
        raw += `\n${lines[i]}`
        depth += (lines[i].match(/\(/g) ?? []).length - (lines[i].match(/\)/g) ?? []).length
      }
      pending.push({ ...parseDecorator(raw.trim()), line: i + 1 })
      continue
    }
    const cls = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/)
    if (cls) {
      className = cls[1]
      classLine = i + 1
      classDecorators = pending
      pending = []
      continue
    }
    if (className && pending.length > 0) {
      const method = line.match(/^(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*[(<]/)
      if (method && pending.some((d) => HTTP.has(d.name))) {
        const http = pending.find((d) => HTTP.has(d.name))
        // Тело обработчика — от сигнатуры до следующего метода класса: нужно для поиска
        // загрузки файла и вызовов сервиса.
        const start = lines.slice(0, i).join('\n').length
        const sigOpen = clean.indexOf('(', start)
        const sigClose = matchParen(clean, sigOpen)
        const bodyOpen = bodyStart(clean, sigClose)
        const bodyClose = matchParen(clean, bodyOpen)
        endpoints.push({
          file: rel(file),
          line: i + 1,
          className,
          handler: method[1],
          httpMethod: http.name.toUpperCase(),
          subPath: firstString(http.args) ?? '',
          decorators: pending,
          signature: clean.slice(sigOpen, sigClose + 1),
          body: bodyOpen > 0 && bodyClose > 0 ? clean.slice(bodyOpen, bodyClose + 1) : '',
        })
      }
      // Любая не-декораторная строка закрывает набор: декораторы свойства или метода без
      // HTTP-маршрута к следующему обработчику не относятся.
      if (line !== '') pending = []
    }
  }

  const controller = classDecorators?.find((d) => d.name === 'Controller')
  if (!controller) return []
  let prefix = firstString(controller.args) ?? ''
  const pathProp = controller.args.match(/path\s*:\s*['"`]([^'"`]*)['"`]/)
  if (pathProp) prefix = pathProp[1]

  return endpoints.map((e) => {
    const byName = (list, name) => list.filter((d) => d.name === name)
    const own = (name) => byName(e.decorators, name)
    const cls = (name) => byName(classDecorators, name)
    // getAllAndOverride([handler, class]): пометка обработчика заменяет пометку класса.
    const resolved = (name) => (own(name).length > 0 ? own(name) : cls(name))
    const throttle = [...own('Throttle'), ...own('AuthThrottle'), ...own('SkipThrottle')]
    const classThrottle = [...cls('Throttle'), ...cls('AuthThrottle'), ...cls('SkipThrottle')]
    return {
      operationId: `${e.className}_${e.handler}`,
      method: e.httpMethod,
      path: joinPath(prefix, e.subPath),
      file: e.file,
      line: e.line,
      classLine,
      handler: e.handler,
      public: resolved('Public').length > 0,
      roles: resolved('Roles').map((d) => d.args.replace(/\s+/g, ' ')),
      restricted: resolved('RestrictedAllowed').map((d) => d.args.replace(/\s+/g, ' ')),
      scope: resolved('Scope').map((d) => d.args.replace(/\s+/g, ' ')),
      mini: resolved('MiniAllowed').length > 0,
      guards: [...cls('UseGuards'), ...own('UseGuards')].map((d) => d.args),
      throttle: (throttle.length > 0 ? throttle : classThrottle).map(
        (d) => `@${d.name}(${d.args.replace(/\s+/g, ' ')})`,
      ),
      signature: e.signature,
      body: e.body,
    }
  })
}

const controllers = SOURCES.filter((s) => s.file.endsWith('.controller.ts'))
const ENDPOINTS = controllers.flatMap(parseController)

// ---------------------------------------------------------------------------------------------
// Сверка с openapi.json

const openapi = JSON.parse(readFileSync(path.join(ROOT, 'apps/api/openapi.json'), 'utf8'))
const OPENAPI_OPS = []
for (const [p, ops] of Object.entries(openapi.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    OPENAPI_OPS.push({ method: method.toUpperCase(), path: p, operationId: op.operationId })
  }
}
const parsedIds = new Set(ENDPOINTS.map((e) => e.operationId))
const openapiIds = new Set(OPENAPI_OPS.map((o) => o.operationId))
const missingInParse = OPENAPI_OPS.filter((o) => !parsedIds.has(o.operationId))
const missingInOpenapi = ENDPOINTS.filter((e) => !openapiIds.has(e.operationId))

// ---------------------------------------------------------------------------------------------
// §6.1 — публичные маршруты против согласованного списка

function documentedPublic() {
  const rules = readFileSync(path.join(ROOT, 'docs/BACKEND_RULES.md'), 'utf8')
  const section = rules.slice(rules.indexOf('### 6.1'), rules.indexOf('### 6.2'))
  const list = []
  for (const m of section.matchAll(/^\s*\|\s*`(GET|POST|PUT|PATCH|DELETE) ([^`]+)`\s*\|/gm)) {
    list.push(`${m[1]} ${m[2].replace(/:(\w+)/g, '{$1}')}`)
  }
  return list
}

const DOC_PUBLIC = documentedPublic()
const PUBLIC = ENDPOINTS.filter((e) => e.public)
const publicKeys = new Set(PUBLIC.map((e) => `${e.method} ${e.path}`))
const publicNotDocumented = PUBLIC.filter((e) => !DOC_PUBLIC.includes(`${e.method} ${e.path}`))
const documentedNotPublic = DOC_PUBLIC.filter((k) => !publicKeys.has(k))

// ---------------------------------------------------------------------------------------------
// §6.1 — без @Roles и без @Public: «любой вошедший»

const OPEN = ENDPOINTS.filter((e) => !e.public && e.roles.length === 0)

// ---------------------------------------------------------------------------------------------
// §14.10 — IDOR: обработчик с {id} в пути, который не передаёт сервису вызывающего

/**
 * Проверить принадлежность ресурса сервис может, только зная, КТО спрашивает. Обработчик с
 * параметром пути, не берущий @CurrentUser(), этого сервису не передаёт — кандидат в IDOR.
 * Публичные маршруты сюда не входят: у них «кто» по определению нет, защита — сам токен.
 */
const IDOR = ENDPOINTS.filter(
  (e) => !e.public && /\{\w+\}/.test(e.path) && !/@CurrentUser\(/.test(e.signature),
)

// ---------------------------------------------------------------------------------------------
// @RestrictedAllowed — что открыто охране и библиотекарю

const RESTRICTED = ENDPOINTS.filter((e) => e.restricted.length > 0)

// ---------------------------------------------------------------------------------------------
// §5.3 / §18.8 — findMany без take

function topLevelKeys(objectText) {
  // objectText начинается с `{`. Ключи на глубине 1: `key:` или сокращённое `key,`/`key }`.
  const keys = []
  let depth = 0
  let token = ''
  for (let i = 0; i < objectText.length; i += 1) {
    const c = objectText[i]
    if (c === "'" || c === '"' || c === '`' || (c === '/' && startsRegex(objectText, i))) {
      i = skipLiteral(objectText, i)
      token = ''
      continue
    }
    if ('{[('.includes(c)) {
      depth += 1
      token = ''
      continue
    }
    if ('}])'.includes(c)) {
      if (depth === 1 && /^\w+$/.test(token.trim())) keys.push(token.trim())
      depth -= 1
      token = ''
      continue
    }
    if (depth === 1) {
      if (c === ':' || c === ',') {
        if (/^\w+$/.test(token.trim())) keys.push(token.trim())
        else if (/^\.\.\./.test(token.trim())) keys.push(token.trim())
        token = ''
      } else if (c === '.' && objectText.slice(i, i + 3) === '...') {
        token = '...'
        i += 2
      } else token += c
    }
  }
  return keys
}

const FIND_MANY = []
for (const { file, text } of SOURCES) {
  const clean = stripComments(text)
  for (const m of clean.matchAll(/\.findMany\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const close = matchParen(clean, open)
    const arg = clean.slice(open + 1, close).trim()
    const where = `${rel(file)}:${lineAt(clean, m.index)}`
    if (arg === '') {
      FIND_MANY.push({ where, verdict: 'NO_ARGS', detail: 'findMany() без аргументов' })
      continue
    }
    if (!arg.startsWith('{')) {
      FIND_MANY.push({
        where,
        verdict: 'DYNAMIC',
        detail: `аргумент — выражение: ${arg.slice(0, 60)}`,
      })
      continue
    }
    const keys = topLevelKeys(arg)
    if (keys.includes('take')) continue
    const spreads = keys.filter((k) => k.startsWith('...'))
    if (spreads.length > 0) {
      FIND_MANY.push({
        where,
        verdict: 'SPREAD',
        detail: `take может прийти из ${spreads.join(', ')}`,
      })
      continue
    }
    // Выборка по списку id (`id: { in: ids }`) ограничена длиной списка — тоже нарушение
    // буквы §18.8, но другого уровня: размер задаёт вызывающий код, а не таблица.
    const boundedByIn = /\bin\s*:/.test(arg)
    FIND_MANY.push({
      where,
      verdict: boundedByIn ? 'BOUNDED_BY_IN' : 'NO_TAKE',
      detail: arg.replace(/\s+/g, ' ').slice(0, 110),
    })
  }
}

// ---------------------------------------------------------------------------------------------
// §6.1 / §18.5 — роль и scope из тела запроса

const SCOPE_FIELDS = ['role', 'universityId', 'facultyId', 'groupId']

/** Поля Zod-схем с этими именами (shared-schemas и локальные DTO api). */
const SCHEMA_FILES = [
  ...walk(path.join(ROOT, 'packages/shared-schemas/src')).map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  })),
  ...SOURCES.filter((s) => /dto/.test(s.file)),
]
const BODY_FIELDS = []
for (const { file, text } of SCHEMA_FILES) {
  const clean = stripComments(text)
  for (const m of clean.matchAll(
    /export\s+const\s+(\w+)\s*=\s*(?:z\s*\.\s*object|z\.strictObject|\w+\.extend|\w+\.merge)\s*\(/g,
  )) {
    const open = m.index + m[0].length - 1
    const close = matchParen(clean, open)
    const body = clean.slice(open, close + 1)
    for (const field of SCOPE_FIELDS) {
      const f = body.match(new RegExp(`\\b${field}\\s*:`))
      if (f) {
        BODY_FIELDS.push({
          schema: m[1],
          field,
          where: `${rel(file)}:${lineAt(clean, open + f.index)}`,
        })
      }
    }
  }
}

/** Где значение поля читается из dto/body и подставляется в фильтр или запись. */
const BODY_READS = []
for (const { file, text } of SOURCES) {
  if (!/\.(service|controller)\.ts$/.test(file)) continue
  const clean = stripComments(text)
  for (const m of clean.matchAll(
    /\b(dto|body|input|data|payload|query)\s*\.\s*(role|universityId|facultyId|groupId)\b/g,
  )) {
    const lineStart = clean.lastIndexOf('\n', m.index) + 1
    const lineEnd = clean.indexOf('\n', m.index)
    const where = `${rel(file)}:${lineAt(clean, m.index)}`
    // Одна строка с двумя упоминаниями (`query.groupId ? { groupId: query.groupId }`) — одна находка.
    if (BODY_READS.some((r) => r.where === where)) continue
    BODY_READS.push({
      where,
      expr: `${m[1]}.${m[2]}`,
      code: clean.slice(lineStart, lineEnd).trim().slice(0, 120),
    })
  }
}

// ---------------------------------------------------------------------------------------------
// §14.9 / §18.6 — секреты пользователя в select и include целиком

const SECRET_FIELDS = [
  'passwordHash',
  'refreshTokenHash',
  'tokenHash',
  'twoFactorSecret',
  'twoFactorBackupCodes',
  'claimSecret',
]
const SECRET_SELECTS = []
for (const { file, text } of SOURCES) {
  const clean = stripComments(text)
  for (const field of SECRET_FIELDS) {
    for (const m of clean.matchAll(new RegExp(`\\b${field}\\s*:\\s*true\\b`, 'g'))) {
      SECRET_SELECTS.push({ where: `${rel(file)}:${lineAt(clean, m.index)}`, field })
    }
  }
}

/**
 * `include: { author: true }` для связи на User отдаёт строку пользователя ЦЕЛИКОМ, вместе
 * с passwordHash. Имена таких связей берём из схемы Prisma.
 */
function userRelationNames() {
  const dir = path.join(ROOT, 'prisma/schema')
  const names = new Set()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.prisma')) continue
    const schema = readFileSync(path.join(dir, name), 'utf8')
    for (const m of schema.matchAll(/^\s+(\w+)\s+User\??\s+@relation/gm)) names.add(m[1])
  }
  return [...names]
}

const USER_RELATIONS = userRelationNames()
const USER_INCLUDES = []
for (const { file, text } of SOURCES) {
  const clean = stripComments(text)
  for (const m of clean.matchAll(/\binclude\s*:\s*\{/g)) {
    const open = m.index + m[0].length - 1
    const close = matchParen(clean, open)
    const body = clean.slice(open, close + 1)
    for (const relName of USER_RELATIONS) {
      const r = body.match(new RegExp(`\\b${relName}\\s*:\\s*true\\b`))
      if (r) {
        USER_INCLUDES.push({
          where: `${rel(file)}:${lineAt(clean, open + r.index)}`,
          relation: relName,
        })
      }
    }
  }
}

/**
 * Запрос к User без `select`: Prisma вернёт строку целиком, с passwordHash и секретом 2FA.
 * Сам по себе не утечка (результат может не уходить наружу), но каждый такой вызов надо
 * глазами довести до ответа API. `updateMany`/`count`/`delete*` строк не возвращают — их не берём.
 */
const USER_NO_SELECT = []
for (const { file, text } of SOURCES) {
  const clean = stripComments(text)
  for (const m of clean.matchAll(
    /\.user\.(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|update|upsert)\s*\(/g,
  )) {
    const open = m.index + m[0].length - 1
    const close = matchParen(clean, open)
    const arg = clean.slice(open + 1, close).trim()
    const keys = arg.startsWith('{') ? topLevelKeys(arg) : []
    if (keys.includes('select') || keys.some((k) => k.startsWith('...'))) continue
    if (!arg.startsWith('{') && arg !== '') continue
    USER_NO_SELECT.push({
      where: `${rel(file)}:${lineAt(clean, m.index)}`,
      call: `user.${m[1]}`,
      include: keys.includes('include'),
    })
  }
}

// ---------------------------------------------------------------------------------------------
// §8 — загрузки файлов через API: тип по magic bytes и лимит размера

const UPLOAD_MARKERS = /readSingleUpload|readUploadWithFields|\.file\(|\.parts\(/
const TYPE_CHECK = /detectAllowedFileType|putAuxImage|\.upload\(/

/** Тело метода сервиса по имени — ищем в файлах того же модуля. */
function serviceMethodBodies(endpointFile, methodName) {
  const dir = path.dirname(path.join(ROOT, endpointFile))
  const bodies = []
  for (const { file, text } of SOURCES) {
    if (path.dirname(file) !== dir) continue
    const clean = stripComments(text)
    for (const m of clean.matchAll(
      new RegExp(
        `\\n\\s+(?:(?:private|public|protected)\\s+)?(?:async\\s+)?${methodName}\\s*\\(`,
        'g',
      ),
    )) {
      const sigOpen = clean.indexOf('(', m.index)
      const sigClose = matchParen(clean, sigOpen)
      const bodyOpen = bodyStart(clean, sigClose)
      const bodyClose = matchParen(clean, bodyOpen)
      if (bodyOpen > 0 && bodyClose > 0) {
        bodies.push({ file: rel(file), text: clean.slice(bodyOpen, bodyClose + 1) })
      }
    }
  }
  return bodies
}

/**
 * Где по цепочке вызовов от обработчика встречается проверка типа. Идём на три уровня вглубь:
 * обработчик → метод сервиса → его приватный помощник → FileService.upload. Только в пределах
 * каталога модуля — чужой модуль за файлом сюда не ходит.
 */
function findTypeCheck(file, body, depth, seen) {
  const evidence = []
  if (TYPE_CHECK.test(body)) evidence.push(file)
  if (depth === 0) return evidence
  const calls = new Set(
    [...body.matchAll(/this\.(?:\w+\.)?(\w+)\s*\(/g)].map((m) => m[1]).filter((c) => !seen.has(c)),
  )
  for (const call of calls) {
    seen.add(call)
    for (const b of serviceMethodBodies(file, call)) {
      for (const hit of findTypeCheck(b.file, b.text, depth - 1, seen))
        evidence.push(`${hit} ← ${call}()`)
    }
  }
  return evidence
}

/**
 * Обработчик читает файл сам или через приватный помощник контроллера (`this.readFile(req)`
 * в импорте таблиц) — второе тоже загрузка, хотя маркера в теле обработчика нет.
 */
function readsUpload(e) {
  if (UPLOAD_MARKERS.test(e.body)) return true
  for (const m of e.body.matchAll(/this\.(\w+)\s*\(\s*req\b/g)) {
    if (serviceMethodBodies(e.file, m[1]).some((b) => UPLOAD_MARKERS.test(b.text))) return true
  }
  return false
}

/** Формат таблицы импорта определяется по расширению имени, а не по содержимому. */
const BY_EXTENSION = /readTableFile|parseLibraryImportFile|parseBulkFile|bulk-parse/

const UPLOADS = ENDPOINTS.filter(readsUpload).map((e) => ({
  operation: `${e.method} ${e.path}`,
  where: `${e.file}:${e.line}`,
  typeCheck: [...new Set(findTypeCheck(e.file, e.body, 3, new Set()))],
  tableImport: BY_EXTENSION.test(e.body) || /filename/.test(e.body),
}))

/** Подтверждение прямой загрузки: confirm обязан идти через FileService.confirmDirectUpload. */
const PRESIGN = ENDPOINTS.filter((e) => /presign|confirm|multipart/i.test(e.path)).map((e) => ({
  operation: `${e.method} ${e.path}`,
  where: `${e.file}:${e.line}`,
}))

// ---------------------------------------------------------------------------------------------
// §14.1–14.6 — остальное, что проверяется грепом

const MISC = { rawUnsafe: [], bcrypt: [], corsWildcard: [], secretLiterals: [] }
for (const { file, text } of SOURCES) {
  const clean = stripComments(text)
  for (const m of clean.matchAll(/\$(queryRawUnsafe|executeRawUnsafe)\s*\(|Prisma\.raw\s*\(/g)) {
    MISC.rawUnsafe.push({
      where: `${rel(file)}:${lineAt(clean, m.index)}`,
      call: m[1] ?? 'Prisma.raw',
    })
  }
  for (const m of clean.matchAll(/bcrypt\.(hash|genSalt)\s*\(([^)]*)\)/g)) {
    MISC.bcrypt.push({ where: `${rel(file)}:${lineAt(clean, m.index)}`, call: m[0].slice(0, 80) })
  }
  for (const m of clean.matchAll(/origin\s*:\s*(['"`]\*['"`]|true)/g)) {
    MISC.corsWildcard.push({ where: `${rel(file)}:${lineAt(clean, m.index)}`, code: m[0] })
  }
  for (const m of clean.matchAll(
    /\b(secret|password|apiKey|api_key|token|privateKey)\w*\s*[:=]\s*['"`]([^'"`\s]{16,})['"`]/gi,
  )) {
    MISC.secretLiterals.push({
      where: `${rel(file)}:${lineAt(clean, m.index)}`,
      code: m[0].slice(0, 60),
    })
  }
}
const mainTs = readFileSync(path.join(API_SRC, 'main.ts'), 'utf8')
MISC.helmet = /app\.register\(\s*helmet/.test(mainTs)
MISC.corsFromEnv = /enableCors\(\{[\s\S]*?CORS_ORIGIN/.test(mainTs)
const envSchema = readFileSync(path.join(API_SRC, 'config/env.schema.ts'), 'utf8')
MISC.envSchema = {
  jwtAccess: /JWT_ACCESS_SECRET\s*:\s*z[\s\S]{0,80}min\(32/.test(envSchema),
  jwtRefresh: /JWT_REFRESH_SECRET\s*:\s*z[\s\S]{0,80}min\(32/.test(envSchema),
}

// ---------------------------------------------------------------------------------------------
// Вывод

const summary = {
  generatedFrom: {
    controllers: controllers.length,
    parsedOperations: ENDPOINTS.length,
    openapiPaths: Object.keys(openapi.paths).length,
    openapiOperations: OPENAPI_OPS.length,
  },
  reconcile: {
    missingInParse: missingInParse.map((o) => `${o.method} ${o.path} (${o.operationId})`),
    missingInOpenapi: missingInOpenapi.map((e) => `${e.method} ${e.path} (${e.operationId})`),
  },
  public: {
    documented: DOC_PUBLIC,
    actual: PUBLIC.map((e) => ({
      operation: `${e.method} ${e.path}`,
      where: `${e.file}:${e.line}`,
      throttle: e.throttle,
      guards: e.guards,
    })),
    notDocumented: publicNotDocumented.map((e) => `${e.method} ${e.path}`),
    documentedButNotPublic: documentedNotPublic,
  },
  idor: IDOR.map((e) => ({
    operation: `${e.method} ${e.path}`,
    where: `${e.file}:${e.line}`,
    roles: e.roles,
  })),
  open: OPEN.map((e) => ({
    operation: `${e.method} ${e.path}`,
    where: `${e.file}:${e.line}`,
    scope: e.scope,
    restricted: e.restricted,
  })),
  restricted: RESTRICTED.map((e) => ({
    operation: `${e.method} ${e.path}`,
    where: `${e.file}:${e.line}`,
    roles: e.restricted,
    endpointRoles: e.roles,
  })),
  findMany: FIND_MANY,
  bodyFields: BODY_FIELDS,
  bodyReads: BODY_READS,
  secretSelects: SECRET_SELECTS,
  userRelations: USER_RELATIONS,
  userIncludes: USER_INCLUDES,
  userNoSelect: USER_NO_SELECT,
  uploads: UPLOADS,
  presign: PRESIGN,
  misc: MISC,
}

// Не process.exit(): в трубу stdout пишется асинхронно, и выход посреди записи обрезал бы
// отчёт на 64 КБ.
console.log(AS_JSON ? JSON.stringify(summary, null, 2) : renderMarkdown())

function renderMarkdown() {
  const out = []
  const h = (s) => out.push('', `## ${s}`, '')
  const li = (s) => out.push(`- ${s}`)
  const code = (s) => `\`${s}\``

  out.push('# Аудит безопасности — автоматическая часть', '')
  out.push(
    `Контроллеров: ${summary.generatedFrom.controllers}, операций разобрано: ${summary.generatedFrom.parsedOperations}; ` +
      `в openapi.json путей ${summary.generatedFrom.openapiPaths}, операций ${summary.generatedFrom.openapiOperations}.`,
  )

  h('Сверка с реестром openapi.json')
  li(`нет в разборе: ${missingInParse.length}`)
  for (const s of summary.reconcile.missingInParse) li(`  ${code(s)}`)
  li(`нет в openapi.json: ${missingInOpenapi.length}`)
  for (const s of summary.reconcile.missingInOpenapi) li(`  ${code(s)}`)

  h(`@Public — ${PUBLIC.length} операций (по §6.1 согласовано ${DOC_PUBLIC.length})`)
  for (const p of summary.public.actual) {
    li(
      `${code(p.operation)} — ${p.where}; throttle: ${p.throttle.join(' ') || 'глобальный 100/мин'}${p.guards.length ? `; guards: ${p.guards.join(', ')}` : ''}`,
    )
  }
  li(`публичные, но не в списке §6.1: ${publicNotDocumented.length}`)
  for (const s of summary.public.notDocumented) li(`  ${code(s)}`)
  li(`в списке §6.1, но не @Public: ${documentedNotPublic.length}`)
  for (const s of documentedNotPublic) li(`  ${code(s)}`)

  h(`Без @Roles и без @Public — ${OPEN.length} операций`)
  const openByFile = new Map()
  for (const e of summary.open) {
    const file = e.where.split(':')[0]
    openByFile.set(file, [...(openByFile.get(file) ?? []), e])
  }
  for (const [file, list] of [...openByFile].sort()) {
    li(`${file}: ${list.map((e) => code(e.operation)).join(', ')}`)
  }

  h(`Параметр в пути без @CurrentUser() — ${IDOR.length} операций`)
  for (const e of summary.idor)
    li(
      `${code(e.operation)} — ${e.where}${e.roles.length ? ` · @Roles(${e.roles.join('; ')})` : ''}`,
    )

  h(`@RestrictedAllowed — ${RESTRICTED.length} операций`)
  for (const r of summary.restricted) {
    li(
      `${code(r.operation)} — ${r.roles.join('; ')}${r.endpointRoles.length ? ` · @Roles(${r.endpointRoles.join('; ')})` : ''} — ${r.where}`,
    )
  }

  h(`findMany без take на верхнем уровне — ${FIND_MANY.length}`)
  for (const f of FIND_MANY) li(`[${f.verdict}] ${f.where} — ${code(f.detail)}`)

  h(`Поля роли/scope в схемах тела — ${BODY_FIELDS.length}`)
  for (const f of BODY_FIELDS) li(`${f.schema}.${f.field} — ${f.where}`)
  h(`Чтение роли/scope из dto/body в сервисах и контроллерах — ${BODY_READS.length}`)
  for (const r of BODY_READS) li(`${r.where} — ${code(r.code)}`)

  h(`Секретные поля в select — ${SECRET_SELECTS.length}`)
  for (const s of SECRET_SELECTS) li(`${s.field} — ${s.where}`)
  h(`include связи на User целиком (\`<rel>: true\`) — ${USER_INCLUDES.length}`)
  out.push(`Связи на User в схеме: ${USER_RELATIONS.join(', ')}`, '')
  for (const s of USER_INCLUDES) li(`${s.relation} — ${s.where}`)
  h(`Запросы к User без select — ${USER_NO_SELECT.length}`)
  for (const s of USER_NO_SELECT) li(`${s.call}${s.include ? ' (include)' : ''} — ${s.where}`)

  h(`Загрузки через API — ${UPLOADS.length}`)
  for (const u of UPLOADS) {
    li(
      `${code(u.operation)} — ${u.where}; проверка типа/размера: ${u.typeCheck.length ? u.typeCheck.join('; ') : u.tableImport ? 'импорт таблицы: формат по расширению имени, в хранилище не пишется — ручной разбор' : '**НЕ НАЙДЕНА — ручной разбор**'}`,
    )
  }
  h(`presign / confirm / multipart — ${PRESIGN.length}`)
  for (const p of PRESIGN) li(`${code(p.operation)} — ${p.where}`)

  h('Прочее §14')
  li(`helmet зарегистрирован: ${MISC.helmet}`)
  li(`CORS из CORS_ORIGIN: ${MISC.corsFromEnv}; origin '*'/true: ${MISC.corsWildcard.length}`)
  li(
    `env: JWT_ACCESS_SECRET min(32): ${MISC.envSchema.jwtAccess}, JWT_REFRESH_SECRET min(32): ${MISC.envSchema.jwtRefresh}`,
  )
  li(`$queryRawUnsafe/$executeRawUnsafe/Prisma.raw: ${MISC.rawUnsafe.length}`)
  for (const r of MISC.rawUnsafe) li(`  ${r.call} — ${r.where}`)
  li(`bcrypt-вызовы: ${MISC.bcrypt.length}`)
  for (const b of MISC.bcrypt) li(`  ${code(b.call)} — ${b.where}`)
  li(`строковые литералы, похожие на секрет: ${MISC.secretLiterals.length}`)
  for (const s of MISC.secretLiterals) li(`  ${code(s.code)} — ${s.where}`)

  return out.join('\n')
}
